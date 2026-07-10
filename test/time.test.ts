import { describe, expect, it } from "vitest";
import { ageDays, relativeTime } from "../src/render/time.js";

const NOW = Date.parse("2026-07-10T09:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime (ja)", () => {
  it("60秒未満は「今」", () => {
    expect(relativeTime(NOW, iso(0), "ja")).toBe("今");
    expect(relativeTime(NOW, iso(59_000), "ja")).toBe("今");
  });
  it("分: 1分〜59分", () => {
    expect(relativeTime(NOW, iso(MIN), "ja")).toBe("1m前");
    expect(relativeTime(NOW, iso(59 * MIN), "ja")).toBe("59m前");
  });
  it("時間: 60分→1h、25時間→1d", () => {
    expect(relativeTime(NOW, iso(60 * MIN), "ja")).toBe("1h前");
    expect(relativeTime(NOW, iso(23 * HOUR), "ja")).toBe("23h前");
    expect(relativeTime(NOW, iso(25 * HOUR), "ja")).toBe("1d前");
  });
  it("日: 8日→8d", () => {
    expect(relativeTime(NOW, iso(8 * DAY), "ja")).toBe("8d前");
    expect(relativeTime(NOW, iso(29 * DAY), "ja")).toBe("29d前");
  });
  it("月・年", () => {
    expect(relativeTime(NOW, iso(45 * DAY), "ja")).toBe("1mo前");
    expect(relativeTime(NOW, iso(400 * DAY), "ja")).toBe("1y前");
  });
  it("未来（時計ずれ）は「今」", () => {
    expect(relativeTime(NOW, iso(-5 * MIN), "ja")).toBe("今");
  });
  it("不正な日付は空文字", () => {
    expect(relativeTime(NOW, "not-a-date", "ja")).toBe("");
  });
});

describe("relativeTime (en)", () => {
  it("now / ago 表記", () => {
    expect(relativeTime(NOW, iso(0), "en")).toBe("now");
    expect(relativeTime(NOW, iso(2 * HOUR), "en")).toBe("2h ago");
  });
});

describe("ageDays", () => {
  it("経過日数を返す", () => {
    expect(ageDays(NOW, iso(3 * DAY))).toBeCloseTo(3);
  });
  it("未来は 0", () => {
    expect(ageDays(NOW, iso(-DAY))).toBe(0);
  });
});
