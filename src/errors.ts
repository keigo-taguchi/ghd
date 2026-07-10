/**
 * 失敗の分類と終了コード対応（docs/SPEC.md §6, §7）。
 * 判定は仕様の順序どおり。認証検出は gh の exit code 単独に依存せず
 * 多重シグナル（exit 4 / stderr の文言 / HTTP 401）で行う。
 */

import { isTotalFailure } from "./derive.js";
import type { Section } from "./model.js";
import type { ParsedResponse } from "./parse.js";

export type ErrorKind =
  | "gh_not_found"
  | "gh_too_old"
  | "timeout"
  | "rate_limited"
  | "unauthenticated"
  | "saml"
  | "forbidden"
  | "network"
  | "usage"
  | "unknown";

export const EXIT_CODES: Record<ErrorKind | "ok", number> = {
  ok: 0,
  unknown: 1,
  gh_too_old: 1,
  usage: 2,
  unauthenticated: 3,
  saml: 3,
  forbidden: 3,
  network: 4,
  timeout: 5,
  rate_limited: 6,
  gh_not_found: 127,
};

export interface ClassifyInput {
  enoent: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stderr: string;
  /** parseResponse の結果（stdout が JSON でなければ null） */
  parsed: ParsedResponse | null;
  sections: readonly Section[];
}

export type Outcome =
  | { kind: "render"; parsed: ParsedResponse }
  | { kind: "error"; error: ErrorKind; detail?: string };

const NETWORK_PATTERNS =
  /getaddrinfo|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|error connecting/i;

export function classifyOutcome(input: ClassifyInput): Outcome {
  const { enoent, timedOut, stderr, parsed, sections } = input;

  // 1. gh 未インストール
  if (enoent) return { kind: "error", error: "gh_not_found" };

  // 2. gh が古い（api graphql 非対応）
  if (/unknown command|unknown flag/i.test(stderr)) {
    return { kind: "error", error: "gh_too_old" };
  }

  // 3. 自前 10 秒タイムアウト
  if (timedOut) return { kind: "error", error: "timeout" };

  // 4. gh api graphql は exit≠0 でも stdout に data+errors を返すことがある。
  //    先に stdout をパースし、1セクションでも取れていれば描画する（部分エラー）。
  if (parsed && !isTotalFailure(parsed, sections)) {
    return { kind: "render", parsed };
  }

  // 5. レート制限（data 実質なし）
  const gqlTypes = parsed?.errors.map((e) => e.type) ?? [];
  if (gqlTypes.includes("RATE_LIMITED") || /rate limit/i.test(stderr)) {
    return {
      kind: "error",
      error: "rate_limited",
      ...(parsed?.rateLimit ? { detail: parsed.rateLimit.resetAt } : {}),
    };
  }

  // 6. 未認証（多重シグナル: gh の exit 4 単独に依存しない）
  if (
    input.exitCode === 4 ||
    /gh auth login/i.test(stderr) ||
    /HTTP 401|not logged in|authentication/i.test(stderr)
  ) {
    return { kind: "error", error: "unauthenticated" };
  }

  // 7. SAML 未認可（search では通常静かに消えるため、主に明示 403 時のみ発火）
  const gqlMessages = parsed?.errors.map((e) => e.message ?? "").join("\n") ?? "";
  if (/SAML/i.test(stderr) || /SAML/i.test(gqlMessages)) {
    return { kind: "error", error: "saml" };
  }

  // 8. 権限不足
  if (/HTTP 403/i.test(stderr) || gqlTypes.includes("FORBIDDEN")) {
    return { kind: "error", error: "forbidden" };
  }

  // 9. ネットワーク断
  if (NETWORK_PATTERNS.test(stderr)) {
    return { kind: "error", error: "network" };
  }

  // 10. その他（gh stderr の先頭行を detail として添える）
  const firstLine = stderr.split("\n").find((l) => l.trim().length > 0);
  return {
    kind: "error",
    error: "unknown",
    ...(firstLine ? { detail: firstLine.trim() } : {}),
  };
}
