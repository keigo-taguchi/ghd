import { describe, expect, it } from "vitest";
import { padEnd, padStart, stringWidth, truncate } from "../src/render/width.js";

describe("stringWidth", () => {
  it("ASCIIは1セル", () => {
    expect(stringWidth("abc")).toBe(3);
  });
  it("日本語は2セル", () => {
    expect(stringWidth("ログ")).toBe(4);
    expect(stringWidth("fix: サイドメニュー")).toBe(5 + 14);
  });
  it("全角記号・全角英数は2セル", () => {
    expect(stringWidth("（監査対象外）")).toBe(14);
    expect(stringWidth("Ａ１")).toBe(4);
  });
  it("サロゲートペア（絵文字）は2セル", () => {
    expect(stringWidth("🚀")).toBe(2);
    expect(stringWidth("a🚀b")).toBe(4);
  });
  it("異体字セレクタは0セル", () => {
    expect(stringWidth("⚠️")).toBe(stringWidth("⚠"));
  });
  it("空文字は0", () => {
    expect(stringWidth("")).toBe(0);
  });
});

describe("truncate", () => {
  it("収まる文字列はそのまま", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });
  it("ASCIIの切り詰め", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });
  it("全角混在: 全角文字の途中で切らない", () => {
    // "ログにノイズが多い" = 18セル。10セルに切ると「ログにノイ」(10) は入らず
    // 「ログにノ」(8) + …(1) = 9セル
    expect(truncate("ログにノイズが多い", 10)).toBe("ログにノ…");
    expect(stringWidth(truncate("ログにノイズが多い", 10))).toBeLessThanOrEqual(10);
  });
  it("サロゲートペアの途中で切らない", () => {
    const t = truncate("ab🚀cd", 4);
    expect(t).toBe("ab…");
    // 不正なサロゲート断片が含まれない
    expect(t.includes("�")).toBe(false);
  });
  it("maxWidth 0 以下は空文字", () => {
    expect(truncate("abc", 0)).toBe("");
  });
  it("maxWidth 1 に全角先頭文字列は…のみ", () => {
    expect(truncate("ログ", 1)).toBe("…");
  });
});

describe("pad", () => {
  it("padEnd は表示幅ベース", () => {
    expect(padEnd("ログ", 6)).toBe("ログ  ");
    expect(padEnd("abc", 6)).toBe("abc   ");
  });
  it("幅超過時はそのまま", () => {
    expect(padEnd("abcdef", 3)).toBe("abcdef");
  });
  it("padStart は表示幅ベース", () => {
    expect(padStart("2h前", 8)).toBe("    2h前");
  });
});
