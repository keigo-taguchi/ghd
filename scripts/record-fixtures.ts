/**
 * 実 gh のレスポンスを test/fixtures/live-full.json に録画する
 * （docs/SPEC.md §4: fixture 採取の制度化）。
 * 実データにはプライベートリポジトリ名が含まれるため live-*.json は
 * .gitignore 済み。チェックインする fixture は必ず手で匿名化すること。
 *
 * 使い方: pnpm fixtures:record
 */

import { writeFileSync } from "node:fs";
import { RealGhRunner } from "../src/gh.js";
import { ALL_SECTIONS } from "../src/model.js";
import { buildGhArgs, buildGraphQLQuery } from "../src/query.js";

const runner = new RealGhRunner();

const version = await runner.exec(["--version"], { timeoutMs: 5_000 });
const t0 = performance.now();
const res = await runner.exec(buildGhArgs(ALL_SECTIONS, { orgs: [], limit: 10 }), {
  stdin: buildGraphQLQuery(ALL_SECTIONS),
  timeoutMs: 15_000,
});
const latencyMs = Math.round(performance.now() - t0);

if (res.code !== 0) {
  console.error(`gh failed (exit ${res.code}):\n${res.stderr}`);
  process.exit(1);
}

const recorded = JSON.parse(res.stdout) as Record<string, unknown>;
recorded["__meta"] = {
  recordedAt: new Date().toISOString(),
  gh: version.stdout.split("\n")[0] ?? "unknown",
  latencyMs,
};

const out = "test/fixtures/live-full.json";
writeFileSync(out, JSON.stringify(recorded, null, 2) + "\n");

const rl = (recorded["data"] as Record<string, unknown> | undefined)?.["rateLimit"] as
  | { cost: number; remaining: number }
  | undefined;
console.log(
  `recorded ${out}: latency=${latencyMs}ms cost=${rl?.cost} remaining=${rl?.remaining}`,
);
