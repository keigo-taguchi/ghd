/**
 * gh api graphql の stdout を正規化前の生ノード列へ寛容にパースする。
 * 方針（docs/SPEC.md §3, §8）:
 *  - ノード単位バリデーション。不正ノードは skip して警告カウント（クラッシュさせない）
 *  - search nodes の null 要素除去（権限フィルタ済み結果で null が混ざる）
 *  - author null（ghost/bot）は Optional として通す
 *  - 手書きバリデータ・依存ゼロ（zod は入れない）
 */

import type { RateLimitInfo, Section } from "./model.js";

export interface RawCheckContext {
  typename: "CheckRun" | "StatusContext";
  /** CheckRun.name または StatusContext.context */
  name: string;
  /** CheckRun のみ: COMPLETED 以外は実行中 */
  status?: string;
  /** CheckRun: conclusion / StatusContext: state */
  conclusion?: string;
}

export interface RawRollup {
  state?: string;
  totalCount: number;
  contexts: RawCheckContext[];
}

export interface RawPrLite {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  repo: string;
  author: string | null;
}

export interface RawPrFull extends RawPrLite {
  reviewDecision: string | null;
  mergeable: string | null;
  /** null = commits 空 or rollup 自体なし（CI未設定 / force-push直後） */
  rollup: RawRollup | null;
}

export interface RawIssue {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  repo: string;
  labels: string[];
}

export interface RawSection<T> {
  totalCount: number;
  nodes: T[];
}

export interface GraphQLErrorEntry {
  type?: string;
  message?: string;
}

export interface ParsedResponse {
  review?: RawSection<RawPrLite>;
  mine?: RawSection<RawPrFull>;
  issues?: RawSection<RawIssue>;
  rateLimit?: RateLimitInfo;
  errors: GraphQLErrorEntry[];
  /** バリデーション失敗で skip したノード数 */
  skipped: number;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number";

function repoName(node: Obj): string | null {
  const repo = node["repository"];
  if (isObj(repo) && isStr(repo["nameWithOwner"])) return repo["nameWithOwner"];
  return null;
}

function authorLogin(node: Obj): string | null {
  const a = node["author"];
  if (isObj(a) && isStr(a["login"])) return a["login"];
  return null; // ghost ユーザー・bot は null になり得る
}

function parsePrCommon(node: Obj): Omit<RawPrLite, "author"> | null {
  const repo = repoName(node);
  if (
    !isNum(node["number"]) ||
    !isStr(node["title"]) ||
    !isStr(node["url"]) ||
    !isStr(node["updatedAt"]) ||
    repo === null
  ) {
    return null;
  }
  return {
    number: node["number"],
    title: node["title"],
    url: node["url"],
    isDraft: node["isDraft"] === true,
    updatedAt: node["updatedAt"],
    repo,
  };
}

function parseRollup(node: Obj): RawRollup | null {
  const commits = node["commits"];
  if (!isObj(commits) || !Array.isArray(commits["nodes"])) return null;
  const first = commits["nodes"][0]; // commits(last:1)
  if (!isObj(first)) return null; // force-push 直後は空配列 → CIなし扱い
  const commit = first["commit"];
  if (!isObj(commit)) return null;
  const rollup = commit["statusCheckRollup"];
  if (!isObj(rollup)) return null; // CI未設定は null

  const contextsRaw = rollup["contexts"];
  const contexts: RawCheckContext[] = [];
  let totalCount = 0;
  if (isObj(contextsRaw)) {
    if (isNum(contextsRaw["totalCount"])) totalCount = contextsRaw["totalCount"];
    const nodes = contextsRaw["nodes"];
    if (Array.isArray(nodes)) {
      for (const c of nodes) {
        if (!isObj(c)) continue;
        if (c["__typename"] === "CheckRun" && isStr(c["name"])) {
          contexts.push({
            typename: "CheckRun",
            name: c["name"],
            ...(isStr(c["status"]) ? { status: c["status"] } : {}),
            ...(isStr(c["conclusion"]) ? { conclusion: c["conclusion"] } : {}),
          });
        } else if (c["__typename"] === "StatusContext" && isStr(c["context"])) {
          contexts.push({
            typename: "StatusContext",
            name: c["context"],
            ...(isStr(c["state"]) ? { conclusion: c["state"] } : {}),
          });
        }
      }
    }
  }
  return {
    ...(isStr(rollup["state"]) ? { state: rollup["state"] } : {}),
    totalCount,
    contexts,
  };
}

function parseSection<T>(
  data: Obj,
  alias: string,
  parseNode: (node: Obj) => T | null,
  counter: { skipped: number },
): RawSection<T> | undefined {
  const section = data[alias];
  if (!isObj(section)) return undefined; // 権限エラー等で節ごと null
  const totalCount = isNum(section["issueCount"]) ? section["issueCount"] : 0;
  const nodes: T[] = [];
  const rawNodes = section["nodes"];
  if (Array.isArray(rawNodes)) {
    for (const n of rawNodes) {
      if (!isObj(n)) continue; // null 要素は黙って除去（仕様: 権限フィルタ由来）
      if (Object.keys(n).length === 0) continue; // inline fragment 不一致の空オブジェクト
      const parsed = parseNode(n);
      if (parsed === null) counter.skipped++;
      else nodes.push(parsed);
    }
  }
  return { totalCount, nodes };
}

/**
 * stdout 全体をパースする。JSON として読めなければ null（呼び出し側で
 * stderr ベースのエラー分類へ回す）。
 */
export function parseResponse(
  stdout: string,
  sections: readonly Section[],
): ParsedResponse | null {
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isObj(root)) return null;

  const errors: GraphQLErrorEntry[] = [];
  if (Array.isArray(root["errors"])) {
    for (const e of root["errors"]) {
      if (isObj(e)) {
        errors.push({
          ...(isStr(e["type"]) ? { type: e["type"] } : {}),
          ...(isStr(e["message"]) ? { message: e["message"] } : {}),
        });
      }
    }
  }

  const data = isObj(root["data"]) ? root["data"] : {};
  const counter = { skipped: 0 };
  const result: ParsedResponse = { errors, skipped: 0 };

  if (sections.includes("review")) {
    const s = parseSection<RawPrLite>(
      data,
      "reviewRequested",
      (n) => {
        const common = parsePrCommon(n);
        return common ? { ...common, author: authorLogin(n) } : null;
      },
      counter,
    );
    if (s) result.review = s;
  }

  if (sections.includes("pr")) {
    const s = parseSection<RawPrFull>(
      data,
      "myPRs",
      (n) => {
        const common = parsePrCommon(n);
        if (!common) return null;
        return {
          ...common,
          author: authorLogin(n),
          reviewDecision: isStr(n["reviewDecision"]) ? n["reviewDecision"] : null,
          mergeable: isStr(n["mergeable"]) ? n["mergeable"] : null,
          rollup: parseRollup(n),
        };
      },
      counter,
    );
    if (s) result.mine = s;
  }

  if (sections.includes("issue")) {
    const s = parseSection<RawIssue>(
      data,
      "assigned",
      (n) => {
        const repo = repoName(n);
        if (
          !isNum(n["number"]) ||
          !isStr(n["title"]) ||
          !isStr(n["url"]) ||
          !isStr(n["updatedAt"]) ||
          repo === null
        ) {
          return null;
        }
        const labels: string[] = [];
        const labelsRaw = n["labels"];
        if (isObj(labelsRaw) && Array.isArray(labelsRaw["nodes"])) {
          for (const l of labelsRaw["nodes"]) {
            if (isObj(l) && isStr(l["name"])) labels.push(l["name"]);
          }
        }
        return {
          number: n["number"],
          title: n["title"],
          url: n["url"],
          updatedAt: n["updatedAt"],
          repo,
          labels,
        };
      },
      counter,
    );
    if (s) result.issues = s;
  }

  const rl = data["rateLimit"];
  if (isObj(rl) && isNum(rl["cost"]) && isNum(rl["remaining"]) && isStr(rl["resetAt"])) {
    result.rateLimit = {
      cost: rl["cost"],
      remaining: rl["remaining"],
      resetAt: rl["resetAt"],
    };
  }

  result.skipped = counter.skipped;
  return result;
}
