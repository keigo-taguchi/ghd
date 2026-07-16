import { describe, expect, it } from "vitest";
import { toDashboard } from "../src/derive.js";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS } from "../src/model.js";
import { renderJson, SCHEMA_VERSION } from "../src/render/json.js";
import full from "./fixtures/full.json";
import partial from "./fixtures/partial-error.json";

const NOW = Date.parse("2026-07-10T09:00:00Z");
const S = (o: unknown) => JSON.stringify(o);

/**
 * schemaVersion 1 の契約を自己検証するバリデータ（docs/SPEC.md §4）。
 * v1 で凍結: フィールド削除・改名にはこのテストが破れる。
 */
function validateV1(o: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (o["schemaVersion"] !== 1) problems.push("schemaVersion must be 1");
  if (typeof o["generatedAt"] !== "string") problems.push("generatedAt missing");
  if (!Array.isArray(o["warnings"])) problems.push("warnings missing");
  if (typeof o["totals"] !== "object") problems.push("totals missing");
  const CI = ["pass", "fail", "pending", "none"];
  const REVIEW = ["approved", "changes_requested", "waiting", null];
  for (const pr of (o["myPullRequests"] as Record<string, unknown>[]) ?? []) {
    for (const key of [
      "number", "title", "repo", "url", "draft", "ci",
      "ciFailedChecks", "ciMoreFailures", "review", "conflict", "ready", "updatedAt",
    ]) {
      if (!(key in pr)) problems.push(`myPullRequests[].${key} missing`);
    }
    if (!CI.includes(pr["ci"] as string)) problems.push(`invalid ci: ${pr["ci"]}`);
    if (!REVIEW.includes(pr["review"] as string | null)) {
      problems.push(`invalid review: ${pr["review"]}`);
    }
  }
  for (const r of (o["reviewRequests"] as Record<string, unknown>[]) ?? []) {
    for (const key of ["number", "title", "repo", "url", "author", "updatedAt"]) {
      if (!(key in r)) problems.push(`reviewRequests[].${key} missing`);
    }
  }
  for (const i of (o["assignedIssues"] as Record<string, unknown>[]) ?? []) {
    for (const key of ["number", "title", "repo", "url", "labels", "priority", "projectStatus", "updatedAt"]) {
      if (!(key in i)) problems.push(`assignedIssues[].${key} missing`);
    }
  }
  return problems;
}

describe("renderJson", () => {
  it("schemaVersion 1 契約を満たす", () => {
    const d = toDashboard(parseResponse(S(full), ALL_SECTIONS)!, ALL_SECTIONS);
    const out = JSON.parse(renderJson(d, { nowMs: NOW, sections: ALL_SECTIONS }));
    expect(validateV1(out)).toEqual([]);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.generatedAt).toBe("2026-07-10T09:00:00.000Z");
    expect(out.totals).toEqual({
      reviewRequests: 2,
      myPullRequests: 3,
      assignedIssues: 5,
    });
  });

  it("スナップショット（v1 凍結の見張り）", () => {
    const d = toDashboard(parseResponse(S(full), ALL_SECTIONS)!, ALL_SECTIONS);
    expect(renderJson(d, { nowMs: NOW, sections: ALL_SECTIONS })).toMatchSnapshot();
  });

  it("部分エラー: 欠けたセクションのキーは出さず warnings に記録", () => {
    const d = toDashboard(parseResponse(S(partial), ALL_SECTIONS)!, ALL_SECTIONS);
    const out = JSON.parse(renderJson(d, { nowMs: NOW, sections: ALL_SECTIONS }));
    expect(out.reviewRequests).toBeUndefined();
    expect(out.myPullRequests).toHaveLength(1);
    expect(out.warnings).toContainEqual({ kind: "partial_error" });
    expect(validateV1(out)).toEqual([]);
  });

  it("サブコマンド絞り込み時は要求セクションのみ", () => {
    const d = toDashboard(parseResponse(S(full), ["issue"])!, ["issue"]);
    const out = JSON.parse(renderJson(d, { nowMs: NOW, sections: ["issue"] }));
    expect(out.assignedIssues).toHaveLength(1);
    expect(out.myPullRequests).toBeUndefined();
    expect(out.totals).toEqual({ assignedIssues: 5 });
  });
});
