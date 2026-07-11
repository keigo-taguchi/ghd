/**
 * 敵対的レビューで確定した指摘（および追加検証で実在と判定した指摘）の
 * リグレッションテスト。各テスト名の [C*]/[U*] はレビュー指摘番号。
 */
import { describe, expect, it } from "vitest";
import { stripControlChars, toDashboard } from "../src/derive.js";
import { parseResponse } from "../src/parse.js";
import { ALL_SECTIONS } from "../src/model.js";
import { renderDashboard, type RenderOptions } from "../src/render/render.js";
import { relativeTime } from "../src/render/time.js";
import { stringWidth } from "../src/render/width.js";
import { resolveColor } from "../src/render/ansi.js";
import { run } from "../src/main.js";
import type { GhExecOptions, GhExecResult, GhRunner } from "../src/gh.js";
import { VERSION } from "../src/version.js";
import { readFileSync } from "node:fs";
import full from "./fixtures/full.json";
import rateLimited from "./fixtures/rate-limited.json";

const NOW = Date.parse("2026-07-10T09:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const OPTS: RenderOptions = {
  lang: "ja",
  width: 80,
  color: false,
  isTTY: true,
  nowMs: NOW,
  sections: ALL_SECTIONS,
};

/** 意地悪データ: 長repo・6桁番号・10ヶ月前(en時8セル)・長priorityラベル */
const nasty = {
  data: {
    reviewRequested: {
      issueCount: 2,
      nodes: [
        {
          number: 123456,
          title: "six digit number",
          url: "https://example.com/1",
          isDraft: false,
          updatedAt: iso(310 * DAY),
          repository: { nameWithOwner: "cureapp/very-long-name-xx" },
          author: { login: "a" },
        },
        {
          number: 99,
          title: "short",
          url: "https://example.com/2",
          isDraft: false,
          updatedAt: iso(DAY),
          repository: { nameWithOwner: "c/a" },
          author: { login: "b" },
        },
      ],
    },
    myPRs: {
      issueCount: 1,
      nodes: [
        {
          number: 700001,
          title: "PR with everything long",
          url: "https://example.com/3",
          isDraft: false,
          updatedAt: iso(310 * DAY),
          reviewDecision: "REVIEW_REQUIRED",
          mergeable: "MERGEABLE",
          repository: { nameWithOwner: "cureapp/very-long-name-xx" },
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        },
      ],
    },
    assigned: {
      issueCount: 1,
      nodes: [
        {
          number: 5,
          title: "issue with huge priority label",
          url: "https://example.com/4",
          updatedAt: iso(2 * DAY),
          repository: { nameWithOwner: "cureapp/very-long-name-xx" },
          labels: { nodes: [{ name: "priority: extremely important thing" }] },
        },
      ],
    },
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-07-10T10:00:00Z" },
  },
};

const nastyDash = () => toDashboard(parseResponse(JSON.stringify(nasty), ALL_SECTIONS)!, ALL_SECTIONS);

describe("[C1] 折り返し禁止の保証: 縮退ロジック", () => {
  it("長repo・長時刻・6桁番号でも各幅で行が width を超えない", () => {
    for (const width of [100, 80, 74, 66, 60, 55, 50, 45]) {
      for (const lang of ["ja", "en"] as const) {
        const out = renderDashboard(nastyDash(), { ...OPTS, width, lang });
        for (const line of out.split("\n")) {
          expect(
            stringWidth(line),
            `width=${width} lang=${lang} line=${JSON.stringify(line)}`,
          ).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it("幅が足りないときは repo を縮めてでもタイトル最小幅を守る", () => {
    // width 66・repo 25文字: 従来は PR 行が幅75で溢れていた帯域
    const out = renderDashboard(nastyDash(), { ...OPTS, width: 66 });
    const prLine = out.split("\n").find((l) => l.includes("#700001"))!;
    expect(prLine).toMatch(/cureapp\/very\S*…/); // repo が縮小 truncate されている
    expect(stringWidth(prLine)).toBeLessThanOrEqual(66);
  });
});

describe("[C2] en の 10mo ago が時刻列に収まる", () => {
  it("relativeTime の最長は 12mo ago = 8セル", () => {
    expect(relativeTime(NOW, iso(310 * DAY), "en")).toBe("10mo ago");
    expect(stringWidth(relativeTime(NOW, iso(310 * DAY), "en"))).toBe(8);
  });
  it("width80 の en 表示で行が 80 を超えない", () => {
    const out = renderDashboard(nastyDash(), { ...OPTS, lang: "en" });
    for (const line of out.split("\n")) {
      expect(stringWidth(line), JSON.stringify(line)).toBeLessThanOrEqual(80);
    }
  });
});

describe("[C3] 6桁以上の番号で番号列が動的に広がる", () => {
  it("同一セクション内でタイトル開始位置が揃う", () => {
    const out = renderDashboard(nastyDash(), { ...OPTS, width: 100 });
    const lines = out.split("\n");
    const l1 = lines.find((l) => l.includes("#123456"))!;
    const l2 = lines.find((l) => l.includes("#99"))!;
    expect(l1.indexOf("six digit")).toBe(l2.indexOf("short"));
  });
});

describe("[C4] totalCount>0 なのに items 空のセクション", () => {
  it("「なし」ではなく「… 他 N 件」を表示する", () => {
    const allSkipped = {
      data: {
        reviewRequested: { issueCount: 3, nodes: [{ number: 1 }] }, // title欠落→skip
        myPRs: { issueCount: 0, nodes: [] },
        assigned: { issueCount: 0, nodes: [] },
      },
    };
    const d = toDashboard(parseResponse(JSON.stringify(allSkipped), ALL_SECTIONS)!, ALL_SECTIONS);
    const out = renderDashboard(d, OPTS);
    expect(out).toContain("▶ レビュー待ち (3)");
    expect(out).toContain("… 他 3 件");
    // (3) の直下に「なし」は出ない
    expect(out).not.toMatch(/レビュー待ち \(3\)\n\s+なし/);
  });
});

class FakeRunner implements GhRunner {
  calls: { args: string[]; opts: GhExecOptions }[] = [];
  constructor(private result: Partial<GhExecResult>) {}
  exec(args: string[], opts: GhExecOptions): Promise<GhExecResult> {
    this.calls.push({ args, opts });
    return Promise.resolve({
      stdout: "", stderr: "", code: 0, enoent: false, timedOut: false,
      ...this.result,
    });
  }
}

async function execMain(
  argv: string[],
  ghResult: Partial<GhExecResult>,
  env: Record<string, string | undefined> = { LANG: "ja_JP.UTF-8" },
  isTTY = true,
) {
  const runner = new FakeRunner(ghResult);
  let out = "", err = "";
  const code = await run({
    runner, env, argv, isTTY, width: 80, nowMs: NOW,
    stdout: (s) => (out += s), stderr: (s) => (err += s),
  });
  return { code, out, err, runner };
}

describe("[C5] FORCE_COLOR=1 で非TTYでも色付きダッシュボード", () => {
  it("パイプ先でも TSV ではなく TTY レイアウト+ANSI", async () => {
    const r = await execMain([], { stdout: JSON.stringify(full) },
      { LANG: "ja_JP.UTF-8", FORCE_COLOR: "1" }, false);
    expect(r.out).toContain("▶");
    expect(r.out).toContain("[1m");
    expect(r.out).not.toMatch(/^review\t/m);
  });
  it("FORCE_COLOR なしの非TTYは従来どおり TSV", async () => {
    const r = await execMain([], { stdout: JSON.stringify(full) },
      { LANG: "ja_JP.UTF-8" }, false);
    expect(r.out).toMatch(/^review\t/m);
  });
  it("NO_COLOR は FORCE_COLOR より強い", async () => {
    const r = await execMain([], { stdout: JSON.stringify(full) },
      { NO_COLOR: "1", FORCE_COLOR: "1" }, false);
    expect(r.out).toMatch(/^review\t/m); // 色なし → pretty 昇格もしない
  });
});

describe("[C6] data+errors 併存時は全セクション揃っていても警告", () => {
  it("errors ありのレスポンスで partial_error 警告", () => {
    const withErrors = { ...JSON.parse(JSON.stringify(full)), errors: [{ type: "FORBIDDEN", message: "x" }] };
    const d = toDashboard(parseResponse(JSON.stringify(withErrors), ALL_SECTIONS)!, ALL_SECTIONS);
    expect(d.warnings).toContainEqual({ kind: "partial_error" });
  });
});

describe("[C7] レート制限で resetAt 不明のときの文言", () => {
  it("「- に回復します」ではなく時刻なしメッセージ", async () => {
    const r = await execMain([], { stdout: JSON.stringify(rateLimited), code: 1 });
    expect(r.code).toBe(6);
    expect(r.err).not.toContain("- に回復");
    expect(r.err).toContain("しばらくしてから再実行");
  });
});

describe("[C9] --limit の負値は拒否せず 1..50 にクランプ", () => {
  it("--limit=-5 → limit=1", async () => {
    const r = await execMain(["--limit=-5"], { stdout: JSON.stringify(full) });
    expect(r.code).toBe(0);
    expect(r.runner.calls[0]!.args).toContain("limit=1");
  });
});

describe("[U1] --org の検索構文注入を拒否", () => {
  it("スペースや検索構文入りは usage エラー", async () => {
    for (const bad of ["cureapp is:closed", "a b", "-leading", "trailing-", ""]) {
      const r = await execMain(["--org", bad], { stdout: JSON.stringify(full) });
      expect(r.code, `org=${JSON.stringify(bad)}`).toBe(2);
      expect(r.runner.calls).toHaveLength(0);
    }
  });
  it("正当な org 名は通る", async () => {
    const r = await execMain(["--org", "CureApp", "--org", "a-b-1"], {
      stdout: JSON.stringify(full),
    });
    expect(r.code).toBe(0);
  });
});

describe("[U2] priority 列の幅キャップ", () => {
  it("長い priority ラベルでも行が width に収まり truncate される", () => {
    const out = renderDashboard(nastyDash(), { ...OPTS, width: 80 });
    const issueLine = out.split("\n").find((l) => l.includes("#5"))!;
    expect(stringWidth(issueLine)).toBeLessThanOrEqual(80);
    expect(issueLine).toContain("priority: e…");
  });
});

describe("[U3] issueCount 欠落時も取得済みアイテムを隠さない", () => {
  it("totalCount は実ノード数を下限にする", () => {
    const noCount = {
      data: {
        reviewRequested: {
          nodes: [
            {
              number: 1, title: "t", url: "u", isDraft: false,
              updatedAt: iso(DAY), repository: { nameWithOwner: "a/b" },
              author: null,
            },
          ],
        },
        myPRs: { issueCount: 0, nodes: [] },
        assigned: { issueCount: 0, nodes: [] },
      },
    };
    const p = parseResponse(JSON.stringify(noCount), ALL_SECTIONS)!;
    expect(p.review!.totalCount).toBe(1);
    const out = renderDashboard(toDashboard(p, ALL_SECTIONS), OPTS);
    expect(out).not.toContain("今やるべきことはありません");
    expect(out).toContain("#1");
  });
});

describe("[U4] bidi 制御文字の strip", () => {
  it("U+202E 等を除去、絵文字合成用 ZWJ は保持", () => {
    expect(stripControlChars("safe‮gnp.exe")).toBe("safegnp.exe");
    expect(stripControlChars("a‏⁦b⁩")).toBe("ab");
    expect(stripControlChars("👨‍👩")).toBe("👨‍👩");
  });
});

describe("[U6] エラー detail の制御文字サニタイズ", () => {
  it("gh stderr 由来の ESC が端末へ流れない", async () => {
    const r = await execMain([], { code: 1, stdout: "", stderr: "[31mboom!" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("boom!");
    expect(r.err).not.toContain("[31m");
  });
  it("argv 由来の usage detail も同様", async () => {
    const r = await execMain(["[2Jevil"], { stdout: "" });
    expect(r.code).toBe(2);
    expect(r.err).not.toContain("[2J");
  });
});

describe("[U9] CheckRun conclusion=STALE は pending 扱い", () => {
  it("STALE のみの rollup で ci=pending（state 欠落時）", () => {
    const stale = {
      data: {
        myPRs: {
          issueCount: 1,
          nodes: [
            {
              number: 1, title: "t", url: "u", isDraft: false,
              updatedAt: iso(DAY), reviewDecision: null, mergeable: "MERGEABLE",
              repository: { nameWithOwner: "a/b" },
              commits: { nodes: [{ commit: { statusCheckRollup: {
                contexts: { totalCount: 1, nodes: [
                  { __typename: "CheckRun", name: "old", status: "COMPLETED", conclusion: "STALE" },
                ] },
              } } }] },
            },
          ],
        },
      },
    };
    const p = parseResponse(JSON.stringify(stale), ["pr"])!;
    const d = toDashboard(p, ["pr"]);
    expect(d.myPullRequests!.items[0]!.ci).toBe("pending");
  });
});

describe("[U10] resolveColor の優先順位チェーン", () => {
  it("--no-color > NO_COLOR > FORCE_COLOR=1 > isTTY", () => {
    expect(resolveColor(true, { FORCE_COLOR: "1" }, true)).toBe(false);
    expect(resolveColor(false, { NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    expect(resolveColor(false, { NO_COLOR: "" }, true)).toBe(true); // 空文字は無効扱い
    expect(resolveColor(false, { FORCE_COLOR: "1" }, false)).toBe(true);
    expect(resolveColor(false, {}, true)).toBe(true);
    expect(resolveColor(false, {}, false)).toBe(false);
  });
});

describe("[U11] バージョンの二重定義の同期", () => {
  it("src/version.ts と package.json が一致する", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
