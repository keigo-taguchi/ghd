import { describe, expect, it } from "vitest";
import { toDashboard } from "../src/derive.js";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS, type Dashboard } from "../src/model.js";
import { renderDashboard, warningLines, type RenderOptions } from "../src/render/render.js";
import { stringWidth } from "../src/render/width.js";
import full from "./fixtures/full.json";
import edge from "./fixtures/edge.json";
import empty from "./fixtures/empty.json";
import partial from "./fixtures/partial-error.json";

const NOW = Date.parse("2026-07-10T09:00:00Z");
const S = (o: unknown) => JSON.stringify(o);

const dash = (fixture: unknown): Dashboard =>
  toDashboard(parseResponse(S(fixture), ALL_SECTIONS)!, ALL_SECTIONS);

const OPTS: RenderOptions = {
  lang: "ja",
  width: 80,
  color: false,
  isTTY: true,
  nowMs: NOW,
  sections: ALL_SECTIONS,
};

describe("renderDashboard TTY", () => {
  it("正常系 ja / width80 / 色なし", () => {
    expect(renderDashboard(dash(full), OPTS)).toMatchSnapshot();
  });

  it("正常系 ja / width80 / 色あり", () => {
    expect(renderDashboard(dash(full), { ...OPTS, color: true })).toMatchSnapshot();
  });

  it("正常系 en / width80", () => {
    expect(renderDashboard(dash(full), { ...OPTS, lang: "en" })).toMatchSnapshot();
  });

  it("width50: repo 列が落ちる", () => {
    const out = renderDashboard(dash(full), { ...OPTS, width: 50 });
    expect(out).not.toContain("cureapp/api");
    expect(out).toMatchSnapshot();
  });

  it("width38: 時刻列も落ちてタイトル最優先", () => {
    const out = renderDashboard(dash(full), { ...OPTS, width: 38 });
    expect(out).not.toContain("2h前");
    expect(out).toMatchSnapshot();
  });

  it("エッジケース: moreFailures / dedupe / pending / ghost author", () => {
    expect(renderDashboard(dash(edge), OPTS)).toMatchSnapshot();
  });

  it("全セクション0件: コンパクト表示 + allClear", () => {
    const out = renderDashboard(dash(empty), OPTS);
    expect(out).toContain("今やるべきことはありません。");
    expect(out).toMatchSnapshot();
  });

  it("部分エラー: 欠けたセクションはスキップし警告フッタ", () => {
    const out = renderDashboard(dash(partial), OPTS);
    expect(out).toContain("⚠ 一部のリポジトリにアクセスできませんでした");
    expect(out).not.toContain("レビュー待ち");
    expect(out).toMatchSnapshot();
  });

  it("1行1アイテム厳守: どの行も表示幅が width を超えない（全フィクスチャ×各幅）", () => {
    for (const f of [full, edge, empty, partial]) {
      for (const width of [120, 80, 66, 60, 50, 45]) {
        const out = renderDashboard(dash(f), { ...OPTS, width });
        for (const line of out.split("\n")) {
          expect(
            stringWidth(line),
            `width=${width} line: ${JSON.stringify(line)}`,
          ).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it("サブコマンド絞り込み: 要求セクションのみ表示", () => {
    const d = toDashboard(parseResponse(S(full), ["pr"])!, ["pr"]);
    const out = renderDashboard(d, { ...OPTS, sections: ["pr"] });
    expect(out).toContain("自分のPR");
    expect(out).not.toContain("レビュー待ち");
    expect(out).toMatchSnapshot();
  });
});

describe("renderDashboard 非TTY (TSV)", () => {
  it("タブ区切り・色なし・省略なし・ISO時刻", () => {
    const out = renderDashboard(dash(full), { ...OPTS, isTTY: false, color: false });
    expect(out).toMatchSnapshot();
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(2 + 3 + 1);
    for (const line of lines) {
      expect(line.split("\t")).toHaveLength(7);
    }
    // ANSI エスケープが混ざらない
    expect(out).not.toContain("[");
  });

  it("draft / ci / review / conflict の state 列", () => {
    const out = renderDashboard(dash(full), { ...OPTS, isTTY: false });
    expect(out).toContain("\tdraft\t");
    expect(out).toContain("\tfail/changes_requested/conflict\t");
    expect(out).toContain("\tpass/waiting\t");
  });
});

describe("warningLines", () => {
  it("警告テキストを言語別に返す", () => {
    expect(
      warningLines([{ kind: "partial_error" }, { kind: "parse_skipped", count: 2 }], "en"),
    ).toEqual([
      "⚠ Some repositories could not be accessed",
      "⚠ Skipped 2 unparseable item(s)",
    ]);
  });
});
