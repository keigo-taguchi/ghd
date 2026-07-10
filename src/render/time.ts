/** 相対時刻表示。now は必ず注入する（docs/SPEC.md §3 副作用注入の原則）。 */

import type { Lang } from "../i18n.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * "2h前" / "2h ago" 形式の相対時刻。
 * 未来の時刻（時計ずれ）は「今」に丸める（docs/SPEC.md §8）。
 */
export function relativeTime(nowMs: number, iso: string, lang: Lang): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = nowMs - then;
  const suffix = lang === "ja" ? "前" : " ago";
  if (diff < MIN) return lang === "ja" ? "今" : "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m${suffix}`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h${suffix}`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d${suffix}`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo${suffix}`;
  return `${Math.floor(diff / (365 * DAY))}y${suffix}`;
}

/** 経過日数（色付け判定用。3日超の時刻を黄色にする）。未来は 0。 */
export function ageDays(nowMs: number, iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (nowMs - then) / DAY);
}
