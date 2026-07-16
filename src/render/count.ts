/**
 * --count: プロンプト・ステータスライン組み込み用の1行出力（例: R2 P3 I1）。
 * 色 = 状態の意味: レビュー待ち>0 は赤（誰かを待たせている）、0件は dim、
 * 部分エラーで取得できなかったセクションは ?（dim）。
 */

import type { Dashboard, Section, SectionData } from "../model.js";
import type { Palette } from "./ansi.js";

const LETTER: Record<Section, string> = { review: "R", pr: "P", issue: "I" };

export function renderCount(
  d: Dashboard,
  sections: readonly Section[],
  p: Palette,
): string {
  const dataOf = (s: Section): SectionData<unknown> | undefined => {
    if (s === "review") return d.reviewRequests;
    if (s === "pr") return d.myPullRequests;
    return d.assignedIssues;
  };
  const parts = sections.map((s) => {
    const data = dataOf(s);
    if (data === undefined) return p.dim(`${LETTER[s]}?`);
    const token = `${LETTER[s]}${data.totalCount}`;
    if (data.totalCount === 0) return p.dim(token);
    return s === "review" ? p.red(token) : token;
  });
  return parts.join(" ") + "\n";
}
