import { describe, expect, it } from "vitest";
import {
  buildGhArgs,
  buildGraphQLQuery,
  buildSearchQueries,
  clampLimit,
} from "../src/query.js";

describe("buildSearchQueries", () => {
  it("レビュー待ちには draft:false、全クエリに sort:updated-desc と archived:false", () => {
    const q = buildSearchQueries([]);
    expect(q.reviewQ).toContain("draft:false");
    expect(q.reviewQ).toContain("review-requested:@me");
    for (const s of [q.reviewQ, q.mineQ, q.issueQ]) {
      expect(s).toContain("sort:updated-desc");
      expect(s).toContain("archived:false");
      expect(s).toContain("is:open");
    }
    expect(q.mineQ).toContain("author:@me");
    expect(q.mineQ).not.toContain("draft:false");
    expect(q.issueQ).toContain("is:issue");
    expect(q.issueQ).toContain("assignee:@me");
  });

  it("--org は各クエリに付加、複数指定可（GitHub search では OR）", () => {
    const q = buildSearchQueries(["cureapp", "myorg"]);
    for (const s of [q.reviewQ, q.mineQ, q.issueQ]) {
      expect(s).toContain("org:cureapp");
      expect(s).toContain("org:myorg");
    }
  });
});

describe("buildGraphQLQuery", () => {
  it("全セクション時は3つのsearch節+rateLimit", () => {
    const doc = buildGraphQLQuery(["review", "pr", "issue"]);
    expect(doc).toContain("reviewRequested:");
    expect(doc).toContain("myPRs:");
    expect(doc).toContain("assigned:");
    expect(doc).toContain("rateLimit");
    expect(doc).toContain("$reviewQ: String!");
    expect(doc).toContain("statusCheckRollup");
    expect(doc).toContain("totalCount");
    expect(doc).toContain("mergeable");
  });

  it("絞り込み時は不要な search 節と変数が残らない", () => {
    const doc = buildGraphQLQuery(["review"]);
    expect(doc).toContain("reviewRequested:");
    expect(doc).not.toContain("myPRs:");
    expect(doc).not.toContain("assigned:");
    expect(doc).not.toContain("$mineQ");
    expect(doc).not.toContain("$issueQ");
    expect(doc).not.toContain("statusCheckRollup");
    // rateLimit は常に取得
    expect(doc).toContain("rateLimit");
  });

  it("issue のみの場合 PR フラグメントの残骸がない", () => {
    const doc = buildGraphQLQuery(["issue"]);
    expect(doc).not.toContain("PullRequest");
    expect(doc).toContain("... on Issue");
    expect(doc).toContain("labels(first: 10)");
  });
});

describe("buildGhArgs", () => {
  it("Int 変数は -F で渡す（-f だと文字列になり型エラー）", () => {
    const args = buildGhArgs(["review", "pr", "issue"], { orgs: [], limit: 10 });
    const fIdx = args.indexOf("-F");
    expect(fIdx).toBeGreaterThan(-1);
    expect(args[fIdx + 1]).toBe("limit=10");
    // 検索クエリ文字列は -f
    expect(args).toContain("-f");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
  });

  it("GraphQL文書のstdin参照 query=@- は -F で渡す（-f はリテラル @- を送る）", () => {
    const args = buildGhArgs(["review"], { orgs: [], limit: 10 });
    expect(args.slice(-2)).toEqual(["-F", "query=@-"]);
    // -f query=@- になっていないこと（実 gh 2.87.3 で破綻を確認済みの誤り）
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i + 1] === "query=@-") expect(args[i]).toBe("-F");
    }
  });

  it("絞り込み時は不要な変数を渡さない", () => {
    const args = buildGhArgs(["issue"], { orgs: [], limit: 5 });
    const joined = args.join(" ");
    expect(joined).toContain("issueQ=");
    expect(joined).not.toContain("reviewQ=");
    expect(joined).not.toContain("mineQ=");
  });
});

describe("clampLimit", () => {
  it("1..50 に黙ってクランプ", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(999)).toBe(50);
    expect(clampLimit(7.9)).toBe(7);
  });
});
