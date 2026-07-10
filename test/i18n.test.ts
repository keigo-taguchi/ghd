import { describe, expect, it } from "vitest";
import { resolveLang, t, TABLES } from "../src/i18n.js";

describe("i18n テーブル", () => {
  it("ja/en のキーが完全一致する", () => {
    expect(Object.keys(TABLES.en).sort()).toEqual(Object.keys(TABLES.ja).sort());
  });
  it("プレースホルダの置換", () => {
    expect(t("ja", "more", { n: 4, limit: 30 })).toBe(
      "… 他 4 件 (--limit 30 で表示)",
    );
    expect(t("en", "warn.parseSkipped", { n: 2 })).toBe(
      "⚠ Skipped 2 unparseable item(s)",
    );
  });
});

describe("resolveLang", () => {
  it("--lang が最優先", () => {
    expect(resolveLang("en", { GHD_LANG: "ja", LANG: "ja_JP.UTF-8" })).toBe("en");
  });
  it("GHD_LANG > LC_ALL > LANG", () => {
    expect(resolveLang(undefined, { GHD_LANG: "ja", LANG: "en_US" })).toBe("ja");
    expect(resolveLang(undefined, { LC_ALL: "ja_JP.UTF-8", LANG: "en_US" })).toBe("ja");
    expect(resolveLang(undefined, { LANG: "ja_JP.UTF-8" })).toBe("ja");
  });
  it("ja* 以外は en、環境変数なしも en", () => {
    expect(resolveLang(undefined, { LANG: "de_DE.UTF-8" })).toBe("en");
    expect(resolveLang(undefined, {})).toBe("en");
  });
});
