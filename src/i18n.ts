/**
 * ja/en 文字列テーブル。キーは両言語で完全一致させる（テストで強制）。
 * レイアウト・記号・バッジ（✓ pass 等）は言語共通なのでここには置かない。
 * データ（PRタイトル・repo名）は無加工で表示し、翻訳しない。
 */

export type Lang = "ja" | "en";

const ja = {
  "section.review": "レビュー待ち",
  "section.pr": "自分のPR",
  "section.issue": "アサインIssue",
  "empty": "なし",
  "allClear": "今やるべきことはありません。",
  "more": "… 他 {n} 件 (--limit {limit} で表示)",
  "review.waiting": "approve待ち",
  "review.changes_requested": "要修正",
  "review.approved": "approved",
  "pr.ready": "⏎ merge可",
  "conflict": "⚠ conflict",
  "ci.hiddenFailures": "他にも失敗あり",
  "open.notFound":
    "#{number} は自分に関係する open な PR/Issue に見つかりません（gh pr view --web -R owner/repo で直接開けます）",
  "open.multiple": "#{number} が複数見つかりました。URL を直接開いてください:",
  "open.browserFailed": "ブラウザを起動できませんでした。上のURLを直接開いてください",
  "open.badUrl": "https 以外のURLのため開きません",
  "warn.partial": "⚠ 一部のリポジトリにアクセスできませんでした",
  "warn.parseSkipped": "⚠ {n}件を解析できませんでした",
  "warn.rateLow": "⚠ APIレート制限の残量が少なくなっています (残り {remaining})",
  "err.ghNotFound":
    "gh が見つかりません。https://cli.github.com からインストールしてください",
  "err.ghTooOld": "gh のアップデートが必要です (gh api graphql 非対応)",
  "err.timeout": "10秒でタイムアウトしました。ネットワークを確認してください",
  "err.rateLimited": "APIレート制限中。{time} に回復します",
  "err.rateLimitedNoTime":
    "APIレート制限中です。しばらくしてから再実行してください",
  "err.unauthenticated": "GitHub に未認証です。まず: gh auth login",
  "err.saml": "組織のSSO認可が必要です: gh auth refresh を実行してください",
  "err.forbidden": "トークンの権限不足です: gh auth refresh -s repo,read:org",
  "err.network": "GitHub に接続できません（オフライン？）",
  "err.unknown": "予期しないエラーです",
  "err.usage": "使い方が誤っています: {detail}",
} as const;

const en: Record<MessageKey, string> = {
  "section.review": "Review requests",
  "section.pr": "My PRs",
  "section.issue": "Assigned issues",
  "empty": "none",
  "allClear": "Nothing needs your attention.",
  "more": "… {n} more (--limit {limit} to show)",
  "review.waiting": "needs review",
  "review.changes_requested": "changes req",
  "review.approved": "approved",
  "pr.ready": "⏎ ready",
  "conflict": "⚠ conflict",
  "ci.hiddenFailures": "more failures",
  "open.notFound":
    "#{number} not found among your open PRs/issues (try: gh pr view --web -R owner/repo)",
  "open.multiple": "Multiple matches for #{number}. Open a URL directly:",
  "open.browserFailed": "Could not launch a browser. Open the URL above directly",
  "open.badUrl": "Refusing to open a non-https URL",
  "warn.partial": "⚠ Some repositories could not be accessed",
  "warn.parseSkipped": "⚠ Skipped {n} unparseable item(s)",
  "warn.rateLow": "⚠ API rate limit is running low ({remaining} left)",
  "err.ghNotFound":
    "gh not found. Install it from https://cli.github.com",
  "err.ghTooOld": "gh needs an update (gh api graphql unsupported)",
  "err.timeout": "Timed out after 10s. Check your network",
  "err.rateLimited": "API rate limited. Resets at {time}",
  "err.rateLimitedNoTime": "API rate limited. Try again in a while",
  "err.unauthenticated": "Not authenticated with GitHub. Run: gh auth login",
  "err.saml": "Your org requires SSO authorization: run gh auth refresh",
  "err.forbidden": "Token lacks scopes: gh auth refresh -s repo,read:org",
  "err.network": "Cannot reach GitHub (offline?)",
  "err.unknown": "Unexpected error",
  "err.usage": "Invalid usage: {detail}",
};

export type MessageKey = keyof typeof ja;

export const TABLES: Record<Lang, Record<MessageKey, string>> = { ja, en };

/** テンプレート引数は {name} 形式。未使用キーが残っても例外にしない。 */
export function t(
  lang: Lang,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let s: string = TABLES[lang][key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** --lang > GHD_LANG > LC_ALL/LANG。ja* 以外はすべて en。 */
export function resolveLang(
  flag: string | undefined,
  env: Record<string, string | undefined>,
): Lang {
  const pick = (v: string | undefined): Lang | null =>
    v === "ja" || v?.startsWith("ja") ? "ja" : v ? "en" : null;
  if (flag === "ja" || flag === "en") return flag;
  return pick(env["GHD_LANG"]) ?? pick(env["LC_ALL"]) ?? pick(env["LANG"]) ?? "en";
}
