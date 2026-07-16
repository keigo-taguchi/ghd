import { describe, expect, it } from "vitest";
import {
  deriveCi,
  derivePriority,
  deriveReview,
  isTotalFailure,
  stripControlChars,
  toDashboard,
} from "../src/derive.js";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS } from "../src/model.js";
import full from "./fixtures/full.json";
import edge from "./fixtures/edge.json";
import partial from "./fixtures/partial-error.json";
import rateLimited from "./fixtures/rate-limited.json";

const S = (o: unknown) => JSON.stringify(o);
const parseEdgePrs = () => parseResponse(S(edge), ["pr"])!.mine!.nodes;

describe("deriveCi", () => {
  it("rollup null（CI未設定・commits空）は none", () => {
    expect(deriveCi(null)).toEqual({ ci: "none", failedChecks: [], moreFailures: false });
  });

  it("SUCCESS rollup は pass、SKIPPED/NEUTRAL は失敗扱いしない", () => {
    const prs = parseResponse(S(full), ["pr"])!.mine!.nodes;
    const pr488 = prs.find((n) => n.number === 488)!;
    expect(deriveCi(pr488.rollup)).toEqual({
      ci: "pass",
      failedChecks: [],
      moreFailures: false,
    });
  });

  it("FAILURE/TIMED_OUT を失敗として名前収集、SUCCESS/SKIPPED は除外", () => {
    const prs = parseResponse(S(full), ["pr"])!.mine!.nodes;
    const pr485 = prs.find((n) => n.number === 485)!;
    const ci = deriveCi(pr485.rollup);
    expect(ci.ci).toBe("fail");
    expect(ci.failedChecks).toEqual(["test/unit", "test/e2e"]);
    expect(ci.moreFailures).toBe(false);
  });

  it("re-run 由来の同名チェックは後勝ち dedupe", () => {
    const pr912 = parseEdgePrs().find((n) => n.number === 912)!;
    const ci = deriveCi(pr912.rollup);
    // flaky: FAILURE→SUCCESS で成功扱い / broken: SUCCESS→FAILURE で失敗扱い
    expect(ci.failedChecks).toEqual(["broken"]);
  });

  it("totalCount > 取得数 のとき moreFailures（失敗名が窓の外）", () => {
    const pr911 = parseEdgePrs().find((n) => n.number === 911)!;
    const ci = deriveCi(pr911.rollup);
    expect(ci.ci).toBe("fail");
    expect(ci.failedChecks).toEqual([]);
    expect(ci.moreFailures).toBe(true);
  });

  it("state 欠落は contexts から導出（実行中あり → pending）", () => {
    const pr913 = parseEdgePrs().find((n) => n.number === 913)!;
    expect(deriveCi(pr913.rollup).ci).toBe("pending");
  });

  it("StatusContext の ERROR は失敗", () => {
    const pr914 = parseEdgePrs().find((n) => n.number === 914)!;
    const ci = deriveCi(pr914.rollup);
    expect(ci.ci).toBe("fail");
    expect(ci.failedChecks).toEqual(["ci/jenkins"]);
  });

  it("PENDING/EXPECTED rollup は pending", () => {
    expect(deriveCi({ state: "PENDING", totalCount: 0, contexts: [] }).ci).toBe("pending");
    expect(deriveCi({ state: "EXPECTED", totalCount: 0, contexts: [] }).ci).toBe("pending");
  });

  it("contexts 空 + state 欠落は pending", () => {
    expect(deriveCi({ totalCount: 0, contexts: [] }).ci).toBe("pending");
  });
});

describe("deriveReview", () => {
  it("APPROVED/CHANGES_REQUESTED/REVIEW_REQUIRED の対応", () => {
    expect(deriveReview("APPROVED")).toBe("approved");
    expect(deriveReview("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(deriveReview("REVIEW_REQUIRED")).toBe("waiting");
  });
  it("null（レビュー必須でない）は null = 状態語を出さない", () => {
    expect(deriveReview(null)).toBeNull();
    expect(deriveReview("SOMETHING_NEW")).toBeNull();
  });
});

describe("derivePriority", () => {
  it("P0-P9 形式", () => {
    expect(derivePriority(["bug", "P2"])).toBe("P2");
    expect(derivePriority(["p0"])).toBe("p0");
  });
  it("priority: プレフィックス", () => {
    expect(derivePriority(["priority: high"])).toBe("priority: high");
    expect(derivePriority(["Priority/Low"])).toBe("Priority/Low");
  });
  it("該当なしは null（P10 や proposal は誤検知しない）", () => {
    expect(derivePriority(["bug", "P10", "proposal"])).toBeNull();
    expect(derivePriority([])).toBeNull();
  });
});

describe("stripControlChars", () => {
  it("ESC・BEL・C1 を除去し、通常文字は保持", () => {
    expect(stripControlChars("a[31mredb")).toBe("a[31mredb");
    expect(stripControlChars("日本語🚀ok")).toBe("日本語🚀ok");
  });
});

describe("toDashboard", () => {
  it("正常系: 3セクション変換・警告なし", () => {
    const d = toDashboard(parseResponse(S(full), ALL_SECTIONS)!, ALL_SECTIONS);
    expect(d.reviewRequests?.items).toHaveLength(2);
    expect(d.myPullRequests?.items.map((i) => i.ci)).toEqual(["pass", "fail", "none"]);
    expect(d.myPullRequests?.items[1]?.conflict).toBe(true);
    expect(d.myPullRequests?.items[2]?.draft).toBe(true);
    expect(d.assignedIssues?.items[0]?.priority).toBe("P2");
    expect(d.warnings).toEqual([]);
  });

  it("部分エラー: 欠けたセクションは undefined + partial_error 警告", () => {
    const d = toDashboard(parseResponse(S(partial), ALL_SECTIONS)!, ALL_SECTIONS);
    expect(d.reviewRequests).toBeUndefined();
    expect(d.myPullRequests?.items).toHaveLength(1);
    expect(d.warnings).toContainEqual({ kind: "partial_error" });
  });

  it("skip があれば parse_skipped 警告", () => {
    const d = toDashboard(parseResponse(S(edge), ALL_SECTIONS)!, ALL_SECTIONS);
    expect(d.warnings).toContainEqual({ kind: "parse_skipped", count: 1 });
  });

  it("タイトル・ラベルの制御文字を strip する", () => {
    const d = toDashboard(parseResponse(S(edge), ["issue"])!, ["issue"]);
    expect(d.assignedIssues?.items[0]?.title).toBe("制御文字[31m入りタイトル");
  });

  it("ready: pass+approved+MERGEABLE のみ true・セクション先頭へ浮上", () => {
    const d = toDashboard(parseResponse(S(edge), ["pr"])!, ["pr"]);
    const items = d.myPullRequests!.items;
    // #915 は updated-desc では末尾だが ready なので先頭へ（他は元の順序を保つ）
    expect(items.map((i) => i.number)).toEqual([915, 910, 911, 912, 913, 914]);
    expect(items[0]?.ready).toBe(true);
    // approved でも CI fail (#911) は ready にならない
    expect(items.find((i) => i.number === 911)?.ready).toBe(false);
  });

  it("ready: CI未設定(none)・approve待ちは偽陽性にしない", () => {
    // #488 (full) は pass+MERGEABLE でも REVIEW_REQUIRED なので ready ではない
    const d = toDashboard(parseResponse(S(full), ["pr"])!, ["pr"]);
    expect(d.myPullRequests?.items.every((i) => !i.ready)).toBe(true);
    // #910 (edge) は commits 空で ci=none（approved でもないが、none 除外の見張り）
    const e = toDashboard(parseResponse(S(edge), ["pr"])!, ["pr"]);
    expect(e.myPullRequests?.items.find((i) => i.number === 910)?.ready).toBe(false);
  });
});

describe("isTotalFailure", () => {
  it("全セクション欠落は true、一部でも取れれば false", () => {
    expect(isTotalFailure(parseResponse(S(rateLimited), ALL_SECTIONS)!, ALL_SECTIONS)).toBe(true);
    expect(isTotalFailure(parseResponse(S(partial), ALL_SECTIONS)!, ALL_SECTIONS)).toBe(false);
    expect(isTotalFailure(parseResponse(S(partial), ["review"])!, ["review"])).toBe(true);
  });
});
