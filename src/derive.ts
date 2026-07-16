/**
 * 正規化前ノード → 表示用ドメインモデルへの解釈（全部純粋関数）。
 * CI 解釈テーブルは設計コンペで確定した規則（docs/SPEC.md §2）:
 *  - rollup なし / commits 空 → "none"（fail/pending と混同させない）
 *  - CheckRun は status→conclusion の2段判定
 *  - 同名チェック（re-run 由来）は後勝ち dedupe
 *  - contexts.totalCount > 取得数 のとき失敗名リストは不完全（moreFailures）
 */

import type {
  CiState,
  Dashboard,
  IssueItem,
  MyPrItem,
  ReviewRequestItem,
  ReviewState,
  Section,
} from "./model.js";
import type {
  GraphQLErrorEntry,
  ParsedResponse,
  RawCheckContext,
  RawRollup,
} from "./parse.js";

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

type CheckOutcome = "failed" | "running" | "ok";

function classifyContext(c: RawCheckContext): CheckOutcome {
  if (c.typename === "CheckRun") {
    if (c.status !== undefined && c.status !== "COMPLETED") return "running";
    if (c.conclusion === undefined) return "running";
    if (FAILED_CONCLUSIONS.has(c.conclusion)) return "failed";
    if (c.conclusion === "STALE") return "running";
    return "ok"; // SUCCESS / NEUTRAL / SKIPPED
  }
  // StatusContext: conclusion フィールドに state を格納している
  if (c.conclusion === "FAILURE" || c.conclusion === "ERROR") return "failed";
  if (c.conclusion === "PENDING") return "running";
  return "ok";
}

export interface CiSummary {
  ci: CiState;
  failedChecks: string[];
  moreFailures: boolean;
}

export function deriveCi(rollup: RawRollup | null): CiSummary {
  if (rollup === null) {
    return { ci: "none", failedChecks: [], moreFailures: false };
  }

  // 同名チェックは後勝ち dedupe（Map の set は挿入順を保ちつつ上書き）
  const deduped = new Map<string, RawCheckContext>();
  for (const c of rollup.contexts) deduped.set(`${c.typename}:${c.name}`, c);

  const failedChecks: string[] = [];
  let anyRunning = false;
  for (const c of deduped.values()) {
    const outcome = classifyContext(c);
    if (outcome === "failed") failedChecks.push(c.name);
    else if (outcome === "running") anyRunning = true;
  }

  const moreFailures = rollup.totalCount > rollup.contexts.length;

  let ci: CiState;
  switch (rollup.state) {
    case "SUCCESS":
      ci = "pass";
      break;
    case "FAILURE":
    case "ERROR":
      ci = "fail";
      break;
    case "PENDING":
    case "EXPECTED":
      ci = "pending";
      break;
    default:
      // state 欠落・未知の値は contexts から導出。contexts 空なら pending
      if (failedChecks.length > 0) ci = "fail";
      else if (anyRunning || deduped.size === 0) ci = "pending";
      else ci = "pass";
  }

  // moreFailures は fail のときのみ意味を持つ（切り詰めで名前を拾えなかった検知）
  return { ci, failedChecks, moreFailures: ci === "fail" && moreFailures };
}

export function deriveReview(reviewDecision: string | null): ReviewState {
  switch (reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "waiting";
    default:
      return null; // レビュー必須でないリポジトリ: 状態語を出さない（嘘をつかない）
  }
}

/** ラベルから優先度をヒューリスティック抽出（P0-P9 / priority:xxx）。 */
export function derivePriority(labels: string[]): string | null {
  for (const l of labels) {
    if (/^p\d$/i.test(l)) return l;
    if (/^priority[:/ ]/i.test(l)) return l;
  }
  return null;
}

/** 双方向テキスト制御文字（U+202E RLO 等）。1件のタイトルで行全体の表示順を
 *  視覚的に反転・偽装できるため除去する。ZWJ/異体字セレクタは絵文字合成に
 *  必要なので残す。 */
const BIDI_CONTROLS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069,
]);

/** 表示インジェクション防御: C0/C1 制御文字・ESC・bidi 制御を除去（docs/SPEC.md §5）。 */
export function stripControlChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || BIDI_CONTROLS.has(cp)) continue;
    out += ch;
  }
  return out;
}

export function toDashboard(
  parsed: ParsedResponse,
  sections: readonly Section[],
): Dashboard {
  const dashboard: Dashboard = { warnings: [] };

  if (sections.includes("review") && parsed.review) {
    const items: ReviewRequestItem[] = parsed.review.nodes.map((n) => ({
      number: n.number,
      title: stripControlChars(n.title),
      url: n.url,
      repo: stripControlChars(n.repo),
      author: n.author === null ? null : stripControlChars(n.author),
      updatedAt: n.updatedAt,
    }));
    dashboard.reviewRequests = { items, totalCount: parsed.review.totalCount };
  }

  if (sections.includes("pr") && parsed.mine) {
    const items: MyPrItem[] = parsed.mine.nodes.map((n) => {
      const { ci, failedChecks, moreFailures } = deriveCi(n.rollup);
      const review = deriveReview(n.reviewDecision);
      // ready は厳格判定: ci=none（CI未設定/force-push直後）や mergeable=UNKNOWN
      // （計算中）を「merge可」と言わない。偽陽性を出すくらいなら出さない
      const ready =
        !n.isDraft && ci === "pass" && review === "approved" && n.mergeable === "MERGEABLE";
      return {
        number: n.number,
        title: stripControlChars(n.title),
        url: n.url,
        repo: stripControlChars(n.repo),
        draft: n.isDraft,
        ci,
        ciFailedChecks: failedChecks.map(stripControlChars),
        ciMoreFailures: moreFailures,
        review,
        conflict: n.mergeable === "CONFLICTING",
        ready,
        updatedAt: n.updatedAt,
      };
    });
    // 出力の上から順=行動優先度: merge可（あとは押すだけ）をセクション先頭へ。
    // 各グループ内は元の sort:updated-desc を保つ（安定パーティション）
    const ordered = [...items.filter((i) => i.ready), ...items.filter((i) => !i.ready)];
    dashboard.myPullRequests = { items: ordered, totalCount: parsed.mine.totalCount };
  }

  if (sections.includes("issue") && parsed.issues) {
    const items: IssueItem[] = parsed.issues.nodes.map((n) => {
      const labels = n.labels.map(stripControlChars);
      return {
        number: n.number,
        title: stripControlChars(n.title),
        url: n.url,
        repo: stripControlChars(n.repo),
        labels,
        priority: derivePriority(labels),
        projectStatus: n.projectStatus === null ? null : stripControlChars(n.projectStatus),
        updatedAt: n.updatedAt,
      };
    });
    dashboard.assignedIssues = { items, totalCount: parsed.issues.totalCount };
  }

  if (parsed.skipped > 0) {
    dashboard.warnings.push({ kind: "parse_skipped", count: parsed.skipped });
  }

  // read:project スコープ不足は「一部リポジトリにアクセスできない」ではなく
  // 「プロジェクト列だけ出せない」なので、専用ヒントに分離する
  if (parsed.errors.some(isProjectScopeError)) {
    dashboard.warnings.push({ kind: "project_scope" });
  }
  const realErrors = parsed.errors.filter((e) => !isProjectScopeError(e));

  // 部分エラー = 要求セクションの欠落、または data と errors の併存
  // （セクションが全て揃っていても errors があれば一部リポジトリが欠けている）
  const missing = sections.some((s) => {
    if (s === "review") return !parsed.review;
    if (s === "pr") return !parsed.mine;
    return !parsed.issues;
  });
  const anyPresent = parsed.review || parsed.mine || parsed.issues;
  if ((missing && anyPresent) || realErrors.length > 0) {
    dashboard.warnings.push({ kind: "partial_error" });
  }

  return dashboard;
}

/** read:project スコープ不足由来の GraphQL エラー判定（main の縮退リトライにも使う）。 */
export function isProjectScopeError(e: GraphQLErrorEntry): boolean {
  return e.type === "INSUFFICIENT_SCOPES" && /read:project|projectItems/i.test(e.message ?? "");
}

/** 要求セクションが1つも取れていない = 全滅（部分エラーではなく致命扱い）。 */
export function isTotalFailure(
  parsed: ParsedResponse,
  sections: readonly Section[],
): boolean {
  return sections.every((s) => {
    if (s === "review") return !parsed.review;
    if (s === "pr") return !parsed.mine;
    return !parsed.issues;
  });
}
