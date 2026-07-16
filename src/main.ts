/**
 * アプリ本体のオーケストレーション。副作用は Deps 経由でのみ触る。
 * cli.ts が本物を注入し、テストは FakeGhRunner と記録用 stdout/stderr を注入する。
 */

import { parseArgs } from "node:util";
import type { UrlOpener } from "./browser.js";
import {
  isProjectScopeError,
  isTotalFailure,
  stripControlChars,
  toDashboard,
} from "./derive.js";
import { classifyOutcome, EXIT_CODES, type ErrorKind } from "./errors.js";
import type { GhRunner } from "./gh.js";
import { type Lang, type MessageKey, resolveLang, t } from "./i18n.js";
import { ALL_SECTIONS, type Section } from "./model.js";
import { type ParsedResponse, parseResponse } from "./parse.js";
import { buildGhArgs, buildGraphQLQuery, clampLimit } from "./query.js";
import { makeAnsi, resolveColor } from "./render/ansi.js";
import { renderCount } from "./render/count.js";
import { renderJson } from "./render/json.js";
import { renderDashboard, warningLines } from "./render/render.js";
import { VERSION } from "./version.js";

const TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 10;
const RATE_WARN_THRESHOLD = 100;
/** open モードはテキスト一致の混入に埋もれないよう常に最大件数で検索する */
const OPEN_SEARCH_LIMIT = 50;
/** GitHub の Issue/PR 番号は Int (2^31-1) 上限 */
const MAX_ISSUE_NUMBER = 2_147_483_647;

export interface Deps {
  runner: GhRunner;
  env: Record<string, string | undefined>;
  /** process.argv.slice(2) 相当 */
  argv: string[];
  isTTY: boolean;
  width: number;
  nowMs: number;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** ブラウザ起動（browser.ts の makeUrlOpener を注入。テストは fake） */
  openUrl: UrlOpener;
}

const SUBCOMMANDS: Record<string, Section> = {
  review: "review",
  pr: "pr",
  issue: "issue",
};

/** 先頭一致でサブコマンド解決（r/p/i の先頭文字は全て異なるため曖昧一致しない）。 */
function resolveSection(arg: string): Section | null {
  if (arg.length === 0) return null;
  const hits = Object.keys(SUBCOMMANDS).filter((c) => c.startsWith(arg));
  return hits.length === 1 ? SUBCOMMANDS[hits[0]!]! : null;
}

function usage(lang: Lang): string {
  if (lang === "ja") {
    return `ghd — GitHub作業ダッシュボード

使い方:
  ghd [review|pr|issue] [オプション]
  ghd <番号>            その番号のPR/Issueをブラウザで開く（非TTYではURL出力のみ）

セクション（先頭一致: r / p / i でも可）:
  (なし)   3セクションすべて表示
  review   レビュー待ちのみ
  pr       自分のPRのみ
  issue    アサインIssueのみ

オプション:
  --org <name>    組織で絞り込み（繰り返し指定可）
  --limit <n>     セクションあたり表示件数 (既定 10, 最大 50)
  --count         件数のみ1行で出力 (例: R2 P3 I1)。プロンプト組み込み用
  --json          機械可読JSONで出力
  --no-color      色を無効化
  --lang ja|en    表示言語
  -h, --help      このヘルプ
  -V, --version   バージョン

環境変数:
  GHD_LANG=ja|en  表示言語（--lang が優先）
  NO_COLOR        色を無効化
  FORCE_COLOR=1   非TTYでも色付きダッシュボード表示 (例: watch -c 'FORCE_COLOR=1 ghd')

終了コード:
  0 成功 / 1 予期しない / 2 使い方 / 3 認証 / 4 ネットワーク / 5 タイムアウト
  6 レート制限 / 127 gh不在
`;
  }
  return `ghd — GitHub work dashboard

Usage:
  ghd [review|pr|issue] [options]
  ghd <number>          open that PR/issue in the browser (non-TTY: print URL only)

Sections (prefix match: r / p / i also work):
  (none)   show all three sections
  review   review requests only
  pr       my PRs only
  issue    assigned issues only

Options:
  --org <name>    filter by organization (repeatable)
  --limit <n>     items per section (default 10, max 50)
  --count         one-line counts only (e.g. R2 P3 I1), for prompts/statuslines
  --json          machine-readable JSON output
  --no-color      disable colors
  --lang ja|en    display language
  -h, --help      this help
  -V, --version   version

Environment:
  GHD_LANG=ja|en  display language (--lang wins)
  NO_COLOR        disable colors
  FORCE_COLOR=1   colored dashboard even when piped (e.g. watch -c 'FORCE_COLOR=1 ghd')

Exit codes:
  0 ok / 1 unexpected / 2 usage / 3 auth / 4 network / 5 timeout
  6 rate limit / 127 gh missing
`;
}

interface ParsedCli {
  sections: readonly Section[];
  orgs: string[];
  limit: number;
  json: boolean;
  /** --count: 件数のみ1行出力 */
  count: boolean;
  noColor: boolean;
  lang: Lang;
  help: boolean;
  version: boolean;
  /** ghd <番号>: 該当PR/Issueをブラウザで開くモード */
  open: number | null;
}

function parseCli(
  argv: string[],
  env: Record<string, string | undefined>,
): ParsedCli | { usageError: string } {
  let values: {
    org?: string[];
    limit?: string;
    json?: boolean;
    count?: boolean;
    "no-color"?: boolean;
    lang?: string;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        org: { type: "string", multiple: true },
        limit: { type: "string" },
        json: { type: "boolean" },
        count: { type: "boolean" },
        "no-color": { type: "boolean" },
        lang: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    return { usageError: e instanceof Error ? e.message : String(e) };
  }

  if (values.lang !== undefined && values.lang !== "ja" && values.lang !== "en") {
    return { usageError: `--lang must be ja or en (got: ${values.lang})` };
  }
  const lang = resolveLang(values.lang, env);

  // GitHub の org/user login は英数字とハイフンのみ。検証しないと
  // --org "cureapp is:closed" のような検索構文注入で結果が静かに変わる
  for (const org of values.org ?? []) {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(org)) {
      return { usageError: `invalid --org: ${org}` };
    }
  }

  let sections: readonly Section[] = ALL_SECTIONS;
  let open: number | null = null;
  if (positionals.length > 1) {
    return { usageError: `too many arguments: ${positionals.join(" ")}` };
  }
  if (positionals.length === 1) {
    const arg = positionals[0]!;
    if (/^\d+$/.test(arg)) {
      const n = Number(arg);
      if (n < 1 || n > MAX_ISSUE_NUMBER) {
        return { usageError: `invalid PR/issue number: ${arg}` };
      }
      open = n;
    } else {
      const s = resolveSection(arg);
      if (s === null) return { usageError: `unknown section: ${arg}` };
      sections = [s];
    }
  }
  if (open !== null && values.json === true) {
    return { usageError: "--json cannot be combined with <number>" };
  }
  if (open !== null && values.count === true) {
    return { usageError: "--count cannot be combined with <number>" };
  }
  if (values.count === true && values.json === true) {
    return { usageError: "--count cannot be combined with --json" };
  }

  let limit = DEFAULT_LIMIT;
  if (values.limit !== undefined) {
    // 負値も「範囲外」として黙って 1..50 にクランプする（docs/SPEC.md §1）
    if (!/^-?\d+$/.test(values.limit)) {
      return { usageError: `--limit must be a number (got: ${values.limit})` };
    }
    limit = clampLimit(Number(values.limit));
  }

  return {
    sections,
    orgs: values.org ?? [],
    limit,
    json: values.json ?? false,
    count: values.count ?? false,
    noColor: values["no-color"] ?? false,
    lang,
    help: values.help ?? false,
    version: values.version ?? false,
    open,
  };
}

/** resetAt(ISO) をローカル時刻 HH:mm へ。パース不能なら "-"。 */
function formatResetTime(iso: string | undefined): string {
  if (iso === undefined) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface OpenMatch {
  url: string;
  repo: string;
  title: string;
}

/** 3セクションの生ノードから番号完全一致を集める（テキスト一致の混入を除去）。 */
function collectOpenMatches(parsed: ParsedResponse, n: number): OpenMatch[] {
  const seen = new Set<string>();
  const out: OpenMatch[] = [];
  const nodes = [
    ...(parsed.review?.nodes ?? []),
    ...(parsed.mine?.nodes ?? []),
    ...(parsed.issues?.nodes ?? []),
  ];
  for (const node of nodes) {
    if (node.number !== n || seen.has(node.url)) continue;
    seen.add(node.url);
    out.push({
      url: stripControlChars(node.url),
      repo: stripControlChars(node.repo),
      title: stripControlChars(node.title),
    });
  }
  return out;
}

/** API 由来だが防御: https 以外は子プロセスに渡さない。 */
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * ghd <番号>: 一意に見つかれば URL を stdout へ出し、TTY ならブラウザも起動する。
 * 0件・複数件・非https は開かず exit 1（unknown 扱い）。
 */
async function runOpen(
  deps: Deps,
  lang: Lang,
  parsed: ParsedResponse,
  number: number,
): Promise<number> {
  const matches = collectOpenMatches(parsed, number);

  if (matches.length === 0) {
    deps.stderr(t(lang, "open.notFound", { number }) + "\n");
    return EXIT_CODES.unknown;
  }
  if (matches.length > 1) {
    deps.stderr(t(lang, "open.multiple", { number }) + "\n");
    for (const m of matches) deps.stdout(`${m.repo}\t${m.title}\t${m.url}\n`);
    return EXIT_CODES.unknown;
  }

  const url = matches[0]!.url;
  if (!isHttpsUrl(url)) {
    deps.stderr(t(lang, "open.badUrl") + "\n");
    return EXIT_CODES.unknown;
  }
  deps.stdout(url + "\n");
  if (deps.isTTY) {
    const ok = await deps.openUrl(url);
    if (!ok) deps.stderr(t(lang, "open.browserFailed") + "\n");
  }
  return EXIT_CODES.ok;
}

const ERROR_MESSAGE_KEYS: Record<ErrorKind, MessageKey> = {
  gh_not_found: "err.ghNotFound",
  gh_too_old: "err.ghTooOld",
  timeout: "err.timeout",
  rate_limited: "err.rateLimited",
  unauthenticated: "err.unauthenticated",
  saml: "err.saml",
  forbidden: "err.forbidden",
  network: "err.network",
  usage: "err.usage",
  unknown: "err.unknown",
};

export async function run(deps: Deps): Promise<number> {
  const cli = parseCli(deps.argv, deps.env);

  if ("usageError" in cli) {
    const lang = resolveLang(undefined, deps.env);
    // detail は argv 由来: 制御文字を落としてから端末へ流す
    const detail = stripControlChars(cli.usageError);
    deps.stderr(t(lang, "err.usage", { detail }) + "\n\n" + usage(lang));
    return EXIT_CODES.usage;
  }
  if (cli.help) {
    deps.stdout(usage(cli.lang));
    return EXIT_CODES.ok;
  }
  if (cli.version) {
    deps.stdout(VERSION + "\n");
    return EXIT_CODES.ok;
  }

  // open モードは3セクション全部を最大件数で検索する（見落とし防止優先）。
  // count モードは nodes を要求しないため first は最小の 1 でよい
  const sections = cli.open !== null ? ALL_SECTIONS : cli.sections;
  const ghArgs = buildGhArgs(sections, {
    orgs: cli.orgs,
    limit: cli.open !== null ? OPEN_SEARCH_LIMIT : cli.count ? 1 : cli.limit,
    ...(cli.open !== null ? { number: cli.open } : {}),
  });
  const doc = buildGraphQLQuery(sections, { countOnly: cli.count });
  let result = await deps.runner.exec(ghArgs, { stdin: doc, timeoutMs: TIMEOUT_MS });
  let parsed = parseResponse(result.stdout, sections);

  // read:project スコープ欠如は GitHub がクエリ全体を INSUFFICIENT_SCOPES で
  // 拒否し得る。ダッシュボード全滅にはせず、projectItems を外して1回だけ
  // 縮退リトライし、専用ヒント警告に変換する（落ちない原則の例外的2往復）
  let projectsDegraded = false;
  if (
    sections.includes("issue") &&
    parsed !== null &&
    isTotalFailure(parsed, sections) &&
    parsed.errors.some(isProjectScopeError)
  ) {
    projectsDegraded = true;
    const degradedDoc = buildGraphQLQuery(sections, { projects: false });
    result = await deps.runner.exec(ghArgs, { stdin: degradedDoc, timeoutMs: TIMEOUT_MS });
    parsed = parseResponse(result.stdout, sections);
  }

  const outcome = classifyOutcome({
    enoent: result.enoent,
    timedOut: result.timedOut,
    exitCode: result.code,
    stderr: result.stderr,
    parsed,
    sections,
  });

  if (outcome.kind === "error") {
    const key = ERROR_MESSAGE_KEYS[outcome.error];
    let msg: string;
    if (outcome.error === "rate_limited") {
      // resetAt はレスポンスに rateLimit 節が残っていた場合のみ得られる
      msg =
        outcome.detail !== undefined
          ? t(cli.lang, key, { time: formatResetTime(outcome.detail) })
          : t(cli.lang, "err.rateLimitedNoTime");
    } else if (outcome.error === "unknown" && outcome.detail !== undefined) {
      // detail は gh の stderr 由来: 制御文字を落としてから端末へ流す
      msg = `${t(cli.lang, key)}: ${stripControlChars(outcome.detail)}`;
    } else {
      msg = t(cli.lang, key);
    }
    deps.stderr(msg + "\n");
    return EXIT_CODES[outcome.error];
  }

  if (cli.open !== null) {
    return runOpen(deps, cli.lang, outcome.parsed, cli.open);
  }

  const dashboard = toDashboard(outcome.parsed, cli.sections);
  if (projectsDegraded) {
    // 縮退リトライ後のレスポンスにはスコープエラーが残らないため、ここで補う
    dashboard.warnings.push({ kind: "project_scope" });
  }

  const rl = outcome.parsed.rateLimit;
  if (rl !== undefined && rl.remaining < RATE_WARN_THRESHOLD) {
    deps.stderr(t(cli.lang, "warn.rateLow", { remaining: rl.remaining }) + "\n");
  }

  if (cli.count) {
    // --count: stdout は1行のみ（コマンド置換で埋め込める）。警告は stderr へ
    const color = resolveColor(cli.noColor, deps.env, deps.isTTY);
    deps.stdout(renderCount(dashboard, cli.sections, makeAnsi(color)));
    for (const w of warningLines(dashboard.warnings, cli.lang)) {
      deps.stderr(w + "\n");
    }
    return EXIT_CODES.ok;
  }

  if (cli.json) {
    // --json: stdout は JSON のみ。警告は warnings 配列に入っている
    deps.stdout(renderJson(dashboard, { nowMs: deps.nowMs, sections: cli.sections }));
    return EXIT_CODES.ok;
  }

  const color = resolveColor(cli.noColor, deps.env, deps.isTTY);
  // FORCE_COLOR=1 は「パイプ先でも色付きダッシュボードが欲しい」という明示指示
  // （watch -c 等）。TSV ではなく TTY レイアウトで描画する
  const pretty = deps.isTTY || (color && deps.env["FORCE_COLOR"] === "1");
  deps.stdout(
    renderDashboard(dashboard, {
      lang: cli.lang,
      width: deps.width,
      color,
      isTTY: pretty,
      nowMs: deps.nowMs,
      sections: cli.sections,
    }),
  );
  if (!pretty) {
    // TSV は stdout を汚さない: 警告は stderr へ
    for (const w of warningLines(dashboard.warnings, cli.lang)) {
      deps.stderr(w + "\n");
    }
  }
  return EXIT_CODES.ok;
}
