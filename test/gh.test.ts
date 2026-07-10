import { describe, expect, it } from "vitest";
import { RealGhRunner } from "../src/gh.js";

// gh 本体は使わず、どの環境にもあるコマンドで RealGhRunner の境界だけを検証する
describe("RealGhRunner", () => {
  it("コマンド不在は enoent: true / code: null（例外を投げない）", async () => {
    const r = await new RealGhRunner("ghd-no-such-binary-xyz").exec([], {
      timeoutMs: 2_000,
    });
    expect(r.enoent).toBe(true);
    expect(r.code).toBeNull();
  });

  it("stdout / stderr / exit code を収集する", async () => {
    const r = await new RealGhRunner("sh").exec(
      ["-c", "printf out; printf err >&2; exit 3"],
      { timeoutMs: 5_000 },
    );
    expect(r.stdout).toBe("out");
    expect(r.stderr).toBe("err");
    expect(r.code).toBe(3);
    expect(r.enoent).toBe(false);
    expect(r.timedOut).toBe(false);
  });

  it("stdin を渡せる（GraphQL文書の受け渡し経路）", async () => {
    const r = await new RealGhRunner("cat").exec([], {
      stdin: "query Dashboard { }",
      timeoutMs: 5_000,
    });
    expect(r.stdout).toBe("query Dashboard { }");
  });

  it("タイムアウトで SIGTERM され timedOut: true", async () => {
    const start = Date.now();
    const r = await new RealGhRunner("sleep").exec(["10"], { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(5_000);
  }, 8_000);
});
