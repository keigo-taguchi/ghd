/** エントリポイント。composition root — 本物の副作用を組み立てて run() に渡すだけ。
 *  shebang はビルド時に esbuild の banner で付与する（scripts/build.mjs）。 */

import process from "node:process";
import { RealGhRunner } from "./gh.js";
import { run } from "./main.js";

const code = await run({
  runner: new RealGhRunner(),
  env: process.env,
  argv: process.argv.slice(2),
  isTTY: process.stdout.isTTY === true,
  // columns は非TTYで undefined、寸法未設定のPTYで 0 になり得る
  width: process.stdout.columns > 0 ? process.stdout.columns : 80,
  nowMs: Date.now(),
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
});
process.exitCode = code;
