import { describe, expect, it } from "vitest";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS } from "../src/model.js";
import full from "./fixtures/full.json";
import edge from "./fixtures/edge.json";
import partial from "./fixtures/partial-error.json";
import rateLimited from "./fixtures/rate-limited.json";

const S = (o: unknown) => JSON.stringify(o);

describe("parseResponse 正常系", () => {
  it("3セクション+rateLimitを取り込む", () => {
    const p = parseResponse(S(full), ALL_SECTIONS)!;
    expect(p.review?.totalCount).toBe(2);
    expect(p.review?.nodes).toHaveLength(2);
    expect(p.mine?.totalCount).toBe(3);
    expect(p.issues?.nodes[0]?.labels).toEqual(["P2", "bug"]);
    expect(p.rateLimit).toEqual({
      cost: 1,
      remaining: 4998,
      resetAt: "2026-07-10T10:00:00Z",
    });
    expect(p.skipped).toBe(0);
    expect(p.errors).toEqual([]);
  });

  it("要求していないセクションは無視する", () => {
    const p = parseResponse(S(full), ["review"])!;
    expect(p.review).toBeDefined();
    expect(p.mine).toBeUndefined();
    expect(p.issues).toBeUndefined();
  });

  it("rollup null は rollup: null として通す", () => {
    const p = parseResponse(S(full), ["pr"])!;
    const draft = p.mine!.nodes.find((n) => n.number === 481)!;
    expect(draft.rollup).toBeNull();
    expect(draft.isDraft).toBe(true);
  });
});

describe("parseResponse 寛容パース", () => {
  it("nodes の null 要素・空オブジェクトは黙って除去（skip カウントしない）", () => {
    const p = parseResponse(S(edge), ALL_SECTIONS)!;
    // review: [null, ghost, タイトル欠落] → ghost のみ有効、欠落は skip
    expect(p.review?.nodes).toHaveLength(1);
    expect(p.review?.nodes[0]?.number).toBe(900);
  });

  it("ghost author (null) は author: null として通す", () => {
    const p = parseResponse(S(edge), ["review"])!;
    expect(p.review?.nodes[0]?.author).toBeNull();
  });

  it("必須フィールド欠落ノードは skip して警告カウント", () => {
    const p = parseResponse(S(edge), ALL_SECTIONS)!;
    // review の title 欠落 1 件のみ（myPRs の {} は fragment 不一致扱いでノーカウント）
    expect(p.skipped).toBe(1);
  });

  it("commits 空配列（force-push直後）は rollup: null", () => {
    const p = parseResponse(S(edge), ["pr"])!;
    const pr = p.mine!.nodes.find((n) => n.number === 910)!;
    expect(pr.rollup).toBeNull();
  });

  it("labels の null 要素は除去", () => {
    const p = parseResponse(S(edge), ["issue"])!;
    expect(p.issues?.nodes[0]?.labels).toEqual(["priority: high"]);
  });

  it("JSONでないstdoutは null", () => {
    expect(parseResponse("gh: command failed", ALL_SECTIONS)).toBeNull();
    expect(parseResponse("", ALL_SECTIONS)).toBeNull();
  });
});

describe("parseResponse 部分エラー", () => {
  it("nullセクションは undefined、errors は保持", () => {
    const p = parseResponse(S(partial), ALL_SECTIONS)!;
    expect(p.review).toBeUndefined();
    expect(p.mine?.nodes).toHaveLength(1);
    expect(p.issues?.totalCount).toBe(0);
    expect(p.errors).toEqual([
      {
        type: "FORBIDDEN",
        message: "Resource not accessible by personal access token",
      },
    ]);
  });

  it("data null（レート制限）は全セクション undefined", () => {
    const p = parseResponse(S(rateLimited), ALL_SECTIONS)!;
    expect(p.review).toBeUndefined();
    expect(p.mine).toBeUndefined();
    expect(p.issues).toBeUndefined();
    expect(p.errors[0]?.type).toBe("RATE_LIMITED");
  });
});
