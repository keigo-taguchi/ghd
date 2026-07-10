/**
 * --json 出力。schemaVersion 1 で凍結（docs/SPEC.md §5）:
 * フィールド追加 = minor / 削除・改名 = schemaVersion インクリメント。
 * 生 GraphQL ではなく正規化済みモデルを出す。JSON キーは常に英語。
 */

import type { Dashboard, Section } from "../model.js";

export const SCHEMA_VERSION = 1;

export function renderJson(
  d: Dashboard,
  opts: { nowMs: number; sections: readonly Section[] },
): string {
  const out: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(opts.nowMs).toISOString(),
  };

  if (opts.sections.includes("review") && d.reviewRequests) {
    out["reviewRequests"] = d.reviewRequests.items.map((i) => ({
      number: i.number,
      title: i.title,
      repo: i.repo,
      url: i.url,
      author: i.author,
      updatedAt: i.updatedAt,
    }));
  }
  if (opts.sections.includes("pr") && d.myPullRequests) {
    out["myPullRequests"] = d.myPullRequests.items.map((i) => ({
      number: i.number,
      title: i.title,
      repo: i.repo,
      url: i.url,
      draft: i.draft,
      ci: i.ci,
      ciFailedChecks: i.ciFailedChecks,
      ciMoreFailures: i.ciMoreFailures,
      review: i.review,
      conflict: i.conflict,
      updatedAt: i.updatedAt,
    }));
  }
  if (opts.sections.includes("issue") && d.assignedIssues) {
    out["assignedIssues"] = d.assignedIssues.items.map((i) => ({
      number: i.number,
      title: i.title,
      repo: i.repo,
      url: i.url,
      labels: i.labels,
      priority: i.priority,
      updatedAt: i.updatedAt,
    }));
  }

  const totals: Record<string, number> = {};
  if (d.reviewRequests) totals["reviewRequests"] = d.reviewRequests.totalCount;
  if (d.myPullRequests) totals["myPullRequests"] = d.myPullRequests.totalCount;
  if (d.assignedIssues) totals["assignedIssues"] = d.assignedIssues.totalCount;
  out["totals"] = totals;
  out["warnings"] = d.warnings;

  return JSON.stringify(out, null, 2) + "\n";
}
