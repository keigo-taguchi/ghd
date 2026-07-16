/**
 * GitHub 検索クエリ文字列と GraphQL 文書のビルダー（純粋関数のみ）。
 * サブコマンド絞り込み時は不要な search 節・変数を文書から実際に削除して
 * 送信する（docs/SPEC.md §1: 絞ると本当に速くなる）。
 */

import type { Section } from "./model.js";

export interface QueryOptions {
  orgs: string[];
  limit: number;
  /** ghd <番号>: 各検索クエリに番号を検索語として追記する（number: 修飾子は
   *  search に存在しないため。裸の番号は該当番号の Issue/PR に一致することを
   *  実測確認済み。テキスト一致の混入は呼び出し側で number 完全一致に絞る） */
  number?: number;
}

const ORG = (orgs: string[]) => orgs.map((o) => ` org:${o}`).join("");

/** レビュー待ちは draft:false でノイズ除去。全クエリ sort:updated-desc 必須。 */
export function buildSearchQueries(
  orgs: string[],
  number?: number,
): {
  reviewQ: string;
  mineQ: string;
  issueQ: string;
} {
  const org = ORG(orgs);
  const num = number !== undefined ? ` ${number}` : "";
  return {
    reviewQ: `is:open is:pr review-requested:@me draft:false archived:false sort:updated-desc${org}${num}`,
    mineQ: `is:open is:pr author:@me archived:false sort:updated-desc${org}${num}`,
    issueQ: `is:open is:issue assignee:@me archived:false sort:updated-desc${org}${num}`,
  };
}

const PR_LITE_FIELDS = `
      number title url isDraft updatedAt
      repository { nameWithOwner }
      author { login }`;

const PR_FULL_FIELDS = `
      number title url isDraft updatedAt reviewDecision mergeable
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup {
        state
        contexts(first: 50) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        }
      } } } }`;

const ISSUE_FIELDS = `
      number title url updatedAt
      repository { nameWithOwner }
      labels(first: 10) { nodes { name } }`;

/** Projects V2 のステータス列（既定フィールド名 "Status" 固定）。
 *  要 read:project スコープ。欠けたトークンでは GitHub がクエリ全体を
 *  INSUFFICIENT_SCOPES で拒否し得るため、main が projects: false で
 *  1回だけ縮退リトライする。 */
const ISSUE_PROJECT_FIELDS = `
      projectItems(first: 5, includeArchived: false) { nodes {
        fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue { name }
        }
      } }`;

export interface QueryDocOptions {
  /** false で projectItems を文書から除去（スコープ縮退リトライ用）。既定 true */
  projects?: boolean;
  /** true で nodes を要求せず issueCount のみ取得（--count 用。既定 false） */
  countOnly?: boolean;
}

/** 要求セクションに対応する search 節だけを含む GraphQL 文書を生成する。 */
export function buildGraphQLQuery(
  sections: readonly Section[],
  docOpts: QueryDocOptions = {},
): string {
  const projects = docOpts.projects ?? true;
  const countOnly = docOpts.countOnly ?? false;
  const vars: string[] = ["$limit: Int!"];
  const blocks: string[] = [];

  // countOnly でも search の first: は必須引数なので $limit は残る（呼び出し側が 1 を渡す）
  const body = (nodesBlock: string) => (countOnly ? "issueCount" : `issueCount${nodesBlock}`);

  if (sections.includes("review")) {
    vars.push("$reviewQ: String!");
    blocks.push(`  reviewRequested: search(query: $reviewQ, type: ISSUE, first: $limit) {
    ${body(`
    nodes { ... on PullRequest {${PR_LITE_FIELDS}
    } }`)}
  }`);
  }
  if (sections.includes("pr")) {
    vars.push("$mineQ: String!");
    blocks.push(`  myPRs: search(query: $mineQ, type: ISSUE, first: $limit) {
    ${body(`
    nodes { ... on PullRequest {${PR_FULL_FIELDS}
    } }`)}
  }`);
  }
  if (sections.includes("issue")) {
    vars.push("$issueQ: String!");
    blocks.push(`  assigned: search(query: $issueQ, type: ISSUE, first: $limit) {
    ${body(`
    nodes { ... on Issue {${ISSUE_FIELDS}${projects ? ISSUE_PROJECT_FIELDS : ""}
    } }`)}
  }`);
  }

  blocks.push("  rateLimit { cost remaining resetAt }");

  return `query Dashboard(${vars.join(", ")}) {\n${blocks.join("\n")}\n}`;
}

/**
 * gh api graphql の引数列。Int 変数は必ず -F（-f は文字列専用で型エラーになる。
 * 設計コンペ api-realist 審査員の指摘）。GraphQL 文書は stdin で渡す。
 * `@-`（stdin 読み込み）のファイル参照構文が効くのは -F のみで、
 * -f query=@- はリテラル "@-" を送ってしまう（実 gh 2.87.3 で確認）。
 */
export function buildGhArgs(
  sections: readonly Section[],
  opts: QueryOptions,
): string[] {
  const q = buildSearchQueries(opts.orgs, opts.number);
  const args = ["api", "graphql", "-F", `limit=${opts.limit}`];
  if (sections.includes("review")) args.push("-f", `reviewQ=${q.reviewQ}`);
  if (sections.includes("pr")) args.push("-f", `mineQ=${q.mineQ}`);
  if (sections.includes("issue")) args.push("-f", `issueQ=${q.issueQ}`);
  args.push("-F", "query=@-");
  return args;
}

/** --limit の値域は拒否せず黙って 1..50 にクランプする（docs/SPEC.md §1）。 */
export function clampLimit(n: number): number {
  return Math.min(50, Math.max(1, Math.trunc(n)));
}
