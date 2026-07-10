/**
 * gh CLI 実行の副作用境界。プロセス起動はこのモジュールだけが行い、
 * テストは GhRunner を FakeGhRunner に差し替える（docs/SPEC.md §4）。
 */

import { spawn } from "node:child_process";

export interface GhExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** gh コマンド自体が見つからなかった */
  enoent: boolean;
  /** 自前タイムアウトで SIGTERM/SIGKILL した */
  timedOut: boolean;
}

export interface GhExecOptions {
  stdin?: string;
  timeoutMs: number;
}

export interface GhRunner {
  exec(args: string[], opts: GhExecOptions): Promise<GhExecResult>;
}

/** shell を経由せず gh を直接 spawn する（シェルエスケープ事故の根絶）。 */
export class RealGhRunner implements GhRunner {
  /** bin はテスト用の注入点（既定 "gh"）。 */
  constructor(private readonly bin: string = "gh") {}

  exec(args: string[], opts: GhExecOptions): Promise<GhExecResult> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, args, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let enoent = false;
      let timedOut = false;
      let settled = false;

      const settle = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(termTimer);
        resolve({ stdout, stderr, code, enoent, timedOut });
      };

      // タイムアウト時は SIGTERM → 2秒待って SIGKILL
      const termTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, opts.timeoutMs);
      termTimer.unref();

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => (stdout += d));
      child.stderr.on("data", (d: string) => (stderr += d));

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") enoent = true;
        settle(null);
      });
      child.on("close", (code) => settle(code));

      if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
      child.stdin.end();
      // stdin への書き込みで EPIPE になっても全体は close で解決する
      child.stdin.on("error", () => {});
    });
  }
}
