/**
 * Dashboard → 文字列。レイアウト決定はすべてここ（純粋関数）。
 * 原則（docs/SPEC.md §5）:
 *  - 固定幅バッジ域: #番号・バッジ・詳細列が縦に揃い、可変長テキストが整列を壊さない
 *  - 1行1アイテム厳守（折り返し禁止）。幅が足りないときは repo縮小 → repo → 時刻 の順に落とす
 *  - 非TTY はタブ区切り・色なし・省略なしに自動切替（grep/awk 耐性）
 *  - 色は状態の意味のみ: 赤=要アクション / 緑=良好 / 黄=進行中・注意 / dim=メタ
 */

import type {
  Dashboard,
  IssueItem,
  MyPrItem,
  ReviewRequestItem,
  Section,
  SectionData,
  Warning,
} from "../model.js";
import { type Lang, type MessageKey, t } from "../i18n.js";
import { makeAnsi, type Palette } from "./ansi.js";
import { ageDays, relativeTime } from "./time.js";
import { padEnd, padStart, stringWidth, truncate } from "./width.js";

export interface RenderOptions {
  lang: Lang;
  width: number;
  color: boolean;
  isTTY: boolean;
  nowMs: number;
  sections: readonly Section[];
}

const INDENT = "  ";
/** 番号列の最小幅。セクション内に大きな番号があれば動的に広がる */
const NUM_W_MIN = 6;
const BADGE_W = 9;
const DETAIL_W = 14;
/** en の最長 "12mo ago" = 8 セル */
const TIME_W = 8;
const GAP = " ";
const MIN_TITLE_W = 8;
const MIN_REPO_W = 4;
const REPO_CAP = 24;
const PRIO_CAP = 12;
/** repo 列を落とす閾値 / 時刻列も落とす閾値 */
const DROP_REPO_BELOW = 60;
const DROP_TIME_BELOW = 40;

const SECTION_KEYS: Record<Section, MessageKey> = {
  review: "section.review",
  pr: "section.pr",
  issue: "section.issue",
};

export function renderDashboard(d: Dashboard, opts: RenderOptions): string {
  if (!opts.isTTY) return renderTsv(d, opts);

  const p = makeAnsi(opts.color);
  const lines: string[] = [];

  const sectionsData = opts.sections.map((s) => ({ section: s, data: dataFor(d, s) }));

  // 取得できた全セクションが 0 件 → コンパクトな all-clear 表示
  const allZero =
    sectionsData.every(({ data }) => data !== undefined && data.totalCount === 0) &&
    sectionsData.length > 0;
  if (allZero) {
    for (const { section } of sectionsData) {
      lines.push(header(section, 0, p, opts.lang));
    }
    lines.push("", t(opts.lang, "allClear"));
    lines.push(...warningLines(d.warnings, opts.lang).map((w) => p.dim(w)));
    return lines.join("\n") + "\n";
  }

  let first = true;
  for (const { section, data } of sectionsData) {
    if (data === undefined) continue; // 部分エラーで欠けたセクション（警告フッタで通知）
    if (!first) lines.push("");
    first = false;

    lines.push(header(section, data.totalCount, p, opts.lang));
    if (data.totalCount === 0) {
      lines.push(INDENT + p.dim(t(opts.lang, "empty")));
      continue;
    }

    // 列幅はセクション内の最大値で統一する（行ごとに変えると縦整列が崩れる）
    const numW = numWidthOf(data.items.map((i) => i.number));
    const repoW = repoWidthOf(data.items.map((i) => i.repo));
    if (section === "review") {
      const cols = layout(opts, plainFixedLeft(numW), repoW, 0);
      lines.push(
        ...(data as SectionData<ReviewRequestItem>).items.map((i) =>
          reviewRow(i, numW, cols, opts, p),
        ),
      );
    } else if (section === "pr") {
      const cols = layout(opts, prFixedLeft(numW), repoW, 0);
      lines.push(
        ...(data as SectionData<MyPrItem>).items.map((i) => prRow(i, numW, cols, opts, p)),
      );
    } else {
      const items = (data as SectionData<IssueItem>).items;
      const prioW = Math.min(
        PRIO_CAP,
        Math.max(0, ...items.map((i) => (i.priority ? stringWidth(i.priority) : 0))),
      );
      const extraW = prioW > 0 ? prioW + GAP.length : 0;
      const cols = layout(opts, plainFixedLeft(numW), repoW, extraW);
      lines.push(...items.map((i) => issueRow(i, numW, prioW, cols, opts, p)));
    }
    // 全ノードが解析不能で skip された場合（items 空・totalCount>0）も件数案内は出す
    if (data.items.length < data.totalCount) {
      const n = data.totalCount - data.items.length;
      const limit = Math.min(50, data.totalCount);
      lines.push(INDENT + p.dim(t(opts.lang, "more", { n, limit })));
    }
  }

  const warns = warningLines(d.warnings, opts.lang);
  if (warns.length > 0) {
    lines.push("", ...warns.map((w) => p.dim(w)));
  }
  return lines.join("\n") + "\n";
}

/** 警告フッタ（TTY では dim 表示、非TTY/JSON では呼び出し側が stderr へ流す）。 */
export function warningLines(warnings: Warning[], lang: Lang): string[] {
  return warnings.map((w) =>
    w.kind === "parse_skipped"
      ? t(lang, "warn.parseSkipped", { n: w.count })
      : t(lang, "warn.partial"),
  );
}

function dataFor(
  d: Dashboard,
  s: Section,
): SectionData<ReviewRequestItem> | SectionData<MyPrItem> | SectionData<IssueItem> | undefined {
  if (s === "review") return d.reviewRequests;
  if (s === "pr") return d.myPullRequests;
  return d.assignedIssues;
}

function header(s: Section, count: number, p: Palette, lang: Lang): string {
  return p.bold(`▶ ${t(lang, SECTION_KEYS[s])} (${count})`);
}

interface Columns {
  showRepo: boolean;
  showTime: boolean;
  titleW: number;
  repoW: number;
}

const plainFixedLeft = (numW: number) => INDENT.length + numW + GAP.length;
const prFixedLeft = (numW: number) =>
  plainFixedLeft(numW) + BADGE_W + GAP.length + DETAIL_W + GAP.length;

function numWidthOf(numbers: number[]): number {
  return Math.max(NUM_W_MIN, ...numbers.map((n) => stringWidth(`#${n}`)));
}

function repoWidthOf(repos: string[]): number {
  return Math.min(REPO_CAP, Math.max(0, ...repos.map(stringWidth)));
}

/**
 * 列幅の決定。タイトル最小幅を満たせないときは repo 縮小 → repo 削除 →
 * 時刻削除 の順に縮退し、「1行1アイテム（折り返し禁止）」を保証する。
 * 最終手段の MIN_TITLE_W クランプに達するのは width < 固定部+8 の極小端末のみ。
 */
function layout(
  opts: RenderOptions,
  fixedLeft: number,
  repoW: number,
  extraW: number,
): Columns {
  let showRepo = opts.width >= DROP_REPO_BELOW;
  let showTime = opts.width >= DROP_TIME_BELOW;

  const titleWidth = (rW: number): number => {
    let w = opts.width - fixedLeft - extraW;
    if (showRepo) w -= rW + GAP.length;
    if (showTime) w -= TIME_W + GAP.length;
    return w;
  };

  let titleW = titleWidth(repoW);
  if (titleW < MIN_TITLE_W && showRepo) {
    // まず repo 列を必要なぶんだけ縮める（repo は truncate 表示になる）
    repoW = Math.max(MIN_REPO_W, repoW - (MIN_TITLE_W - titleW));
    titleW = titleWidth(repoW);
    if (titleW < MIN_TITLE_W) {
      showRepo = false;
      titleW = titleWidth(0);
    }
  }
  if (titleW < MIN_TITLE_W && showTime) {
    showTime = false;
    titleW = titleWidth(repoW);
  }
  return { showRepo, showTime, titleW: Math.max(MIN_TITLE_W, titleW), repoW };
}

function tail(
  parts: string[],
  item: { repo: string; updatedAt: string },
  cols: Columns,
  opts: RenderOptions,
  p: Palette,
): void {
  if (cols.showRepo) {
    parts.push(p.dim(padEnd(truncate(item.repo, cols.repoW), cols.repoW)));
  }
  if (cols.showTime) {
    const rel = padStart(relativeTime(opts.nowMs, item.updatedAt, opts.lang), TIME_W);
    const stale = ageDays(opts.nowMs, item.updatedAt) > 3;
    parts.push(stale ? p.yellow(rel) : p.dim(rel));
  }
}

function reviewRow(
  item: ReviewRequestItem,
  numW: number,
  cols: Columns,
  opts: RenderOptions,
  p: Palette,
): string {
  const parts = [INDENT + p.bold(padEnd(`#${item.number}`, numW))];
  parts.push(padEnd(truncate(item.title, cols.titleW), cols.titleW));
  tail(parts, item, cols, opts, p);
  return parts.join(GAP).trimEnd();
}

function prBadge(item: MyPrItem, p: Palette): string {
  if (item.draft) return p.dim(padEnd("● draft", BADGE_W));
  switch (item.ci) {
    case "pass":
      return p.green(padEnd("✓ pass", BADGE_W));
    case "fail":
      return p.red(padEnd("✗ fail", BADGE_W));
    case "pending":
      return p.yellow(padEnd("● run", BADGE_W));
    default:
      return p.dim(padEnd("–", BADGE_W));
  }
}

/** 詳細列は1つだけ: CI失敗チェック名 > ⚠ conflict > レビュー状態語。draft は空。 */
function prDetail(item: MyPrItem, opts: RenderOptions, p: Palette): string {
  if (item.draft) return padEnd("", DETAIL_W);
  if (item.ci === "fail" && (item.ciFailedChecks.length > 0 || item.ciMoreFailures)) {
    const name = item.ciFailedChecks[0];
    const plus = item.ciFailedChecks.length > 1 || item.ciMoreFailures ? "+" : "";
    const text =
      name !== undefined
        ? truncate(name, DETAIL_W - plus.length) + plus
        : truncate(t(opts.lang, "ci.hiddenFailures"), DETAIL_W);
    return p.red(padEnd(text, DETAIL_W));
  }
  if (item.conflict) {
    return p.yellow(padEnd(truncate(t(opts.lang, "conflict"), DETAIL_W), DETAIL_W));
  }
  if (item.review === "approved") {
    return p.green(padEnd(truncate(t(opts.lang, "review.approved"), DETAIL_W), DETAIL_W));
  }
  if (item.review === "changes_requested") {
    return p.red(padEnd(truncate(t(opts.lang, "review.changes_requested"), DETAIL_W), DETAIL_W));
  }
  if (item.review === "waiting") {
    return padEnd(truncate(t(opts.lang, "review.waiting"), DETAIL_W), DETAIL_W);
  }
  return padEnd("", DETAIL_W);
}

function prRow(
  item: MyPrItem,
  numW: number,
  cols: Columns,
  opts: RenderOptions,
  p: Palette,
): string {
  const parts = [
    INDENT + p.bold(padEnd(`#${item.number}`, numW)),
    prBadge(item, p),
    prDetail(item, opts, p),
    padEnd(truncate(item.title, cols.titleW), cols.titleW),
  ];
  tail(parts, item, cols, opts, p);
  return parts.join(GAP).trimEnd();
}

function issueRow(
  item: IssueItem,
  numW: number,
  prioW: number,
  cols: Columns,
  opts: RenderOptions,
  p: Palette,
): string {
  const parts = [INDENT + p.bold(padEnd(`#${item.number}`, numW))];
  parts.push(padEnd(truncate(item.title, cols.titleW), cols.titleW));
  if (prioW > 0) {
    parts.push(p.yellow(padEnd(truncate(item.priority ?? "", prioW), prioW)));
  }
  tail(parts, item, cols, opts, p);
  return parts.join(GAP).trimEnd();
}

/** 非TTY: 色なし・省略なしのタブ区切り。列 = section, number, repo, title, state, updatedAt, url */
function renderTsv(d: Dashboard, opts: RenderOptions): string {
  const rows: string[][] = [];
  if (opts.sections.includes("review") && d.reviewRequests) {
    for (const i of d.reviewRequests.items) {
      rows.push(["review", `${i.number}`, i.repo, i.title, i.author ?? "", i.updatedAt, i.url]);
    }
  }
  if (opts.sections.includes("pr") && d.myPullRequests) {
    for (const i of d.myPullRequests.items) {
      const state = i.draft
        ? "draft"
        : i.ci +
          (i.review !== null ? `/${i.review}` : "") +
          (i.conflict ? "/conflict" : "");
      rows.push(["pr", `${i.number}`, i.repo, i.title, state, i.updatedAt, i.url]);
    }
  }
  if (opts.sections.includes("issue") && d.assignedIssues) {
    for (const i of d.assignedIssues.items) {
      rows.push(["issue", `${i.number}`, i.repo, i.title, i.labels.join(","), i.updatedAt, i.url]);
    }
  }
  return rows.map((r) => r.join("\t") + "\n").join("");
}
