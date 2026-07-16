/**
 * ブラウザ起動の副作用境界。gh.ts と同様、プロセス起動はこのモジュールに閉じ、
 * テストは Deps.openUrl を差し替える。URL は https スキームを呼び出し側で
 * 検証してから渡す（引数インジェクション対策）。
 */

import { spawn } from "node:child_process";

export type UrlOpener = (url: string) => Promise<boolean>;

/** 起動コマンド: BROWSER 環境変数 > プラットフォーム既定 (open / start / xdg-open)。 */
export function makeUrlOpener(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): UrlOpener {
  return (url) =>
    new Promise((resolve) => {
      const browser = env["BROWSER"];
      const [cmd, args]: [string, string[]] =
        browser !== undefined && browser !== ""
          ? [browser, [url]]
          : platform === "darwin"
            ? ["open", [url]]
            : platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]];

      const child = spawn(cmd, args, { stdio: "ignore" });
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      // ランチャが2秒で戻らない場合は起動成功とみなして先へ進む
      // （open/xdg-open は通常ms単位で exit する。ハングで ghd を道連れにしない）
      const timer = setTimeout(() => settle(true), 2_000);
      child.unref();
      child.on("error", () => settle(false));
      child.on("close", (code) => settle(code === 0));
    });
}
