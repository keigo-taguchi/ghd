import { describe, expect, it } from "vitest";
import type { GhExecOptions, GhExecResult, GhRunner } from "../src/gh.js";
import { type Deps, run } from "../src/main.js";
import full from "./fixtures/full.json";
import edge from "./fixtures/edge.json";
import empty from "./fixtures/empty.json";
import partial from "./fixtures/partial-error.json";
import rateLimited from "./fixtures/rate-limited.json";

const NOW = Date.parse("2026-07-10T09:00:00Z");

/** テーブル駆動の FakeGhRunner。呼び出しを記録し、固定レスポンスを返す。 */
class FakeGhRunner implements GhRunner {
  calls: { args: string[]; opts: GhExecOptions }[] = [];
  constructor(private result: Partial<GhExecResult>) {}
  exec(args: string[], opts: GhExecOptions): Promise<GhExecResult> {
    this.calls.push({ args, opts });
    return Promise.resolve({
      stdout: "",
      stderr: "",
      code: 0,
      enoent: false,
      timedOut: false,
      ...this.result,
    });
  }
}

interface Captured {
  code: number;
  out: string;
  err: string;
  runner: FakeGhRunner;
  opened: string[];
}

async function exec(
  argv: string[],
  ghResult: Partial<GhExecResult>,
  depsOverride: Partial<Deps> = {},
): Promise<Captured> {
  const runner = new FakeGhRunner(ghResult);
  let out = "";
  let err = "";
  const opened: string[] = [];
  const code = await run({
    runner,
    env: { LANG: "ja_JP.UTF-8" },
    argv,
    isTTY: true,
    width: 80,
    nowMs: NOW,
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve(true);
    },
    ...depsOverride,
  });
  return { code, out, err, runner, opened };
}

const ok = (fixture: unknown) => ({ stdout: JSON.stringify(fixture), code: 0 });

describe("run 正常系", () => {
  it("引数なし: 3セクション表示・exit 0・ghは1回だけ呼ばれる", async () => {
    const r = await exec([], ok(full));
    expect(r.code).toBe(0);
    expect(r.out).toContain("▶ レビュー待ち (2)");
    expect(r.out).toContain("▶ 自分のPR (3)");
    expect(r.out).toContain("▶ アサインIssue (5)");
    expect(r.err).toBe("");
    expect(r.runner.calls).toHaveLength(1);
  });

  it("gh 引数: -F limit / -f 検索クエリ / query=@- / GraphQL文書はstdin", async () => {
    const r = await exec([], ok(full));
    const { args, opts } = r.runner.calls[0]!;
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args).toContain("-F");
    expect(args[args.indexOf("-F") + 1]).toBe("limit=10");
    expect(args.at(-1)).toBe("query=@-");
    expect(opts.stdin).toContain("query Dashboard(");
    expect(opts.timeoutMs).toBe(10_000);
  });

  it("サブコマンド先頭一致: ghd r はレビューのみ・クエリからも他節が消える", async () => {
    const r = await exec(["r"], ok(full));
    expect(r.code).toBe(0);
    expect(r.out).toContain("レビュー待ち");
    expect(r.out).not.toContain("自分のPR");
    const { args, opts } = r.runner.calls[0]!;
    expect(args.join(" ")).toContain("reviewQ=");
    expect(args.join(" ")).not.toContain("mineQ=");
    expect(opts.stdin).not.toContain("myPRs");
    expect(opts.stdin).not.toContain("statusCheckRollup");
  });

  it("--org は検索クエリに複数付加される", async () => {
    const r = await exec(["--org", "cureapp", "--org", "acme"], ok(full));
    const joined = r.runner.calls[0]!.args.join(" ");
    expect(joined).toContain("org:cureapp");
    expect(joined).toContain("org:acme");
  });

  it("--limit は 1..50 にクランプ", async () => {
    const r = await exec(["--limit", "200"], ok(full));
    expect(r.runner.calls[0]!.args).toContain("limit=50");
  });

  it("--json: schemaVersion付きJSONのみをstdoutへ", async () => {
    const r = await exec(["--json"], ok(full));
    const parsed = JSON.parse(r.out);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.myPullRequests).toHaveLength(3);
    expect(r.code).toBe(0);
  });

  it("非TTY: TSV出力・警告はstderrへ", async () => {
    const r = await exec([], ok(partial), { isTTY: false });
    expect(r.code).toBe(0);
    expect(r.out).toContain("\t");
    expect(r.out).not.toContain("⚠");
    expect(r.err).toContain("⚠ 一部のリポジトリにアクセスできませんでした");
  });

  it("レート残量僅少の警告はstderrへ（表示は正常に出る）", async () => {
    const r = await exec([], ok(edge));
    expect(r.code).toBe(0);
    expect(r.err).toContain("残り 88");
    expect(r.out).toContain("▶");
  });

  it("全0件: allClear で exit 0", async () => {
    const r = await exec([], ok(empty));
    expect(r.code).toBe(0);
    expect(r.out).toContain("今やるべきことはありません。");
  });

  it("--lang en で英語表示", async () => {
    const r = await exec(["--lang", "en"], ok(full));
    expect(r.out).toContain("Review requests");
  });
});

describe("run openモード (ghd <番号>)", () => {
  it("一意ヒット: URLをstdoutへ出しブラウザを開く・番号が検索クエリに付く", async () => {
    const r = await exec(["485"], ok(full));
    expect(r.code).toBe(0);
    expect(r.out).toBe("https://github.com/cureapp/api/pull/485\n");
    expect(r.opened).toEqual(["https://github.com/cureapp/api/pull/485"]);
    // 1往復のまま: 3セクション検索へ番号を追記し limit は最大値
    expect(r.runner.calls).toHaveLength(1);
    const { args } = r.runner.calls[0]!;
    const joined = args.join(" ");
    expect(joined).toContain("sort:updated-desc 485");
    expect(args).toContain("limit=50");
    expect(joined).toContain("reviewQ=");
    expect(joined).toContain("mineQ=");
    expect(joined).toContain("issueQ=");
  });

  it("非TTY: URL出力のみでブラウザは開かない", async () => {
    const r = await exec(["485"], ok(full), { isTTY: false });
    expect(r.code).toBe(0);
    expect(r.out).toBe("https://github.com/cureapp/api/pull/485\n");
    expect(r.opened).toEqual([]);
  });

  it("見つからない番号 → exit 1 + 案内", async () => {
    const r = await exec(["9999"], ok(full));
    expect(r.code).toBe(1);
    expect(r.err).toContain("#9999");
    expect(r.opened).toEqual([]);
  });

  it("複数ヒット（別リポジトリ同番号）→ 開かず候補一覧 + exit 1", async () => {
    // full の #482 (review) と同番号の issue を合成
    const fixture = structuredClone(full) as typeof full & {
      data: { assigned: { nodes: unknown[] } };
    };
    fixture.data.assigned.nodes.push({
      number: 482,
      title: "同番号のissue",
      url: "https://github.com/cureapp/app/issues/482",
      updatedAt: "2026-07-09T09:00:00Z",
      repository: { nameWithOwner: "cureapp/app" },
      labels: { nodes: [] },
    });
    const r = await exec(["482"], ok(fixture));
    expect(r.code).toBe(1);
    expect(r.err).toContain("複数見つかりました");
    expect(r.out).toContain("https://github.com/cureapp/api/pull/482");
    expect(r.out).toContain("https://github.com/cureapp/app/issues/482");
    expect(r.opened).toEqual([]);
  });

  it("同一PRが複数セクションに出てもURLで重複排除され一意扱い", async () => {
    // #482 を myPRs にも複製（review と同じ URL）
    const fixture = structuredClone(full) as typeof full & {
      data: { myPRs: { nodes: unknown[] } };
    };
    fixture.data.myPRs.nodes.push({
      ...structuredClone(fixture.data.reviewRequested.nodes[0]),
      reviewDecision: null,
      mergeable: "UNKNOWN",
      commits: { nodes: [] },
    });
    const r = await exec(["482"], ok(fixture));
    expect(r.code).toBe(0);
    expect(r.opened).toEqual(["https://github.com/cureapp/api/pull/482"]);
  });

  it("ブラウザ起動失敗 → URLは出力済みなので警告のみで exit 0", async () => {
    const r = await exec(["485"], ok(full), {
      openUrl: () => Promise.resolve(false),
    });
    expect(r.code).toBe(0);
    expect(r.out).toBe("https://github.com/cureapp/api/pull/485\n");
    expect(r.err).toContain("ブラウザを起動できませんでした");
  });

  it("https以外のURLは開かない", async () => {
    const fixture = structuredClone(full) as typeof full;
    fixture.data.myPRs.nodes[1]!.url = "javascript:alert(1)";
    const r = await exec(["485"], ok(fixture));
    expect(r.code).toBe(1);
    expect(r.opened).toEqual([]);
  });

  it("--json との併用 → exit 2", async () => {
    const r = await exec(["485", "--json"], ok(full));
    expect(r.code).toBe(2);
    expect(r.runner.calls).toHaveLength(0);
  });

  it("0 や範囲外の番号 → exit 2", async () => {
    expect((await exec(["0"], ok(full))).code).toBe(2);
    expect((await exec(["99999999999"], ok(full))).code).toBe(2);
  });
});

describe("run ヘルプ・バージョン・usage エラー", () => {
  it("--help は gh を呼ばず usage を stdout へ", async () => {
    const r = await exec(["--help"], ok(full));
    expect(r.code).toBe(0);
    expect(r.out).toContain("使い方");
    expect(r.runner.calls).toHaveLength(0);
  });

  it("-V はバージョンのみ", async () => {
    const r = await exec(["-V"], ok(full));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("0.1.0");
  });

  it("未知フラグ → exit 2 + usage を stderr へ", async () => {
    const r = await exec(["--frobnicate"], ok(full));
    expect(r.code).toBe(2);
    expect(r.err).toContain("使い方");
    expect(r.runner.calls).toHaveLength(0);
  });

  it("未知サブコマンド → exit 2", async () => {
    const r = await exec(["xyz"], ok(full));
    expect(r.code).toBe(2);
  });

  it("--limit 非数値 → exit 2", async () => {
    const r = await exec(["--limit", "abc"], ok(full));
    expect(r.code).toBe(2);
  });

  it("--lang 不正値 → exit 2", async () => {
    const r = await exec(["--lang", "fr"], ok(full));
    expect(r.code).toBe(2);
  });
});

describe("run エラー経路", () => {
  it("gh 不在 → exit 127", async () => {
    const r = await exec([], { enoent: true, code: null });
    expect(r.code).toBe(127);
    expect(r.err).toContain("gh が見つかりません");
  });

  it("タイムアウト → exit 5", async () => {
    const r = await exec([], { timedOut: true, code: null });
    expect(r.code).toBe(5);
    expect(r.err).toContain("タイムアウト");
  });

  it("未認証 (gh exit 4) → exit 3", async () => {
    const r = await exec([], { code: 4, stderr: "To authenticate, run gh auth login" });
    expect(r.code).toBe(3);
    expect(r.err).toContain("gh auth login");
  });

  it("ネットワーク断 → exit 4", async () => {
    const r = await exec([], {
      code: 1,
      stderr: "dial tcp: lookup api.github.com: getaddrinfo ENOTFOUND",
    });
    expect(r.code).toBe(4);
    expect(r.err).toContain("接続できません");
  });

  it("レート制限 → exit 6", async () => {
    const r = await exec([], { ...ok(rateLimited), code: 1 });
    expect(r.code).toBe(6);
    expect(r.err).toContain("レート制限");
  });

  it("部分エラーは失敗ではない: exit 0 + 取れた分を描画", async () => {
    const r = await exec([], { ...ok(partial), code: 1, stderr: "GraphQL error" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("#488");
    expect(r.out).toContain("⚠ 一部のリポジトリにアクセスできませんでした");
  });

  it("stdout が JSON でない予期しない失敗 → exit 1 + stderr要約", async () => {
    const r = await exec([], { code: 1, stdout: "", stderr: "boom!\ndetails" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("予期しないエラー");
    expect(r.err).toContain("boom!");
  });
});
