/** esbuild JS API で dist/ghd.mjs 単一ファイルへバンドルする（起動時 node_modules 解決コストゼロ）。 */
import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/ghd.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync("dist/ghd.mjs", 0o755);
console.log("built dist/ghd.mjs");
