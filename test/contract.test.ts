import { describe, expect, it } from "vitest";
import { RealGhRunner } from "../src/gh.js";
import { ALL_SECTIONS } from "../src/model.js";
import { parseResponse } from "../src/parse.js";
import { buildGhArgs, buildGraphQLQuery } from "../src/query.js";

/**
 * 実 gh を叩く契約テスト。ローカル/週次CIで GHD_CONTRACT_TEST=1 のときだけ実行
 * （docs/SPEC.md §4: gh / GitHub API 劣化の継続検知経路）。
 */
const enabled = process.env["GHD_CONTRACT_TEST"] === "1";

describe.skipIf(!enabled)("contract: 実 GitHub API との契約", () => {
  it(
    "本番クエリが1往復で通り、パースでき、コストが安い",
    async () => {
      const runner = new RealGhRunner();
      const t0 = performance.now();
      const res = await runner.exec(
        buildGhArgs(ALL_SECTIONS, { orgs: [], limit: 10 }),
        { stdin: buildGraphQLQuery(ALL_SECTIONS), timeoutMs: 15_000 },
      );
      const latencyMs = Math.round(performance.now() - t0);

      expect(res.enoent).toBe(false);
      expect(res.code, res.stderr).toBe(0);

      const parsed = parseResponse(res.stdout, ALL_SECTIONS);
      expect(parsed).not.toBeNull();
      expect(parsed!.review).toBeDefined();
      expect(parsed!.mine).toBeDefined();
      expect(parsed!.issues).toBeDefined();
      expect(parsed!.skipped).toBe(0);

      // レートコスト実測: 設計想定は 1-3pt（超えたらクエリが重くなった兆候）
      expect(parsed!.rateLimit).toBeDefined();
      expect(parsed!.rateLimit!.cost).toBeLessThanOrEqual(3);

      // eslint-disable-next-line no-console
      console.log(`contract: latency=${latencyMs}ms cost=${parsed!.rateLimit!.cost}`);
    },
    30_000,
  );
});
