# ghd v1 最終仕様書 — 「1リクエスト・1画面・1秒」ダッシュボード（統合版）

## 0. 位置づけと設計原則

設計コンペ最高得点案（「1リクエスト・1画面・1秒」）をベースに、審査員指摘の欠陥をすべて解消し、複数審査員が推した敗者案のアイディアを取り込んだ最終仕様。

- **思想**: 毎朝の最初の1コマンド。引数ゼロ・API 1往復・1画面の静的出力で「誰を待たせているか／何が壊れているか／次に何をやるか」を3秒で判断させる。
- **原則**: (1) API呼び出しは常に1回（viewer preflightはしない。`@me` はGitHub search構文としてサーバ側でネイティブに動くため事前login取得は不要——コンペ案2の「クライアント展開」説は事実誤認と全審査員が確認済み）。(2) 出力の上から順＝行動優先度。(3) 色＝状態の一対一対応。(4) ランタイム依存ゼロ。(5) 落ちない——ノード単位の寛容パースで1ノードの形状変化を全画面クラッシュにしない。

### コンペ審査で確定した主要変更点（ベース案からの差分）
| # | 変更 | 出典・根拠 |
|---|---|---|
| 1 | レビュー待ちクエリに `draft:false` 追加 | 全審査員 |
| 2 | statusCheckRollup 解釈テーブル一式（2段判定・dedupe・totalCount検知）を案2から移植、`contexts(first:50)` + `totalCount` 取得 | 全審査員（first:100は重すぎとapi-realistが警告、50で確定） |
| 3 | search `nodes` の null 要素除去・ghost author(null) の Optional 化 | maintainer / api-realist |
| 4 | `--json` に `schemaVersion` | 全審査員 |
| 5 | Int 変数は `-F limit=N` で渡す（`-f` は文字列専用） | api-realist（初回実行で型エラーになる欠陥の修正） |
| 6 | サブコマンド絞り込み時に GraphQL クエリから不要な search 節を実際に削除 | 全審査員 |
| 7 | esbuild 単一ファイルバンドル | 全審査員 |
| 8 | commits 空配列（force-push直後）ガード | daily-user / api-realist |
| 9 | 終了コード細分化（認証/ネットワーク/タイムアウト/レート） | maintainer / api-realist |
| 10 | バッジ域を固定幅化し可変長テキストによる縦整列崩壊を解消 | daily-user（実装時破綻の指摘） |
| 11 | 認証検出を exit code 4 単独依存にしない多重シグナル判定 | daily-user / maintainer |
| 12 | SAML 未認可の専用メッセージ | daily-user / maintainer（api-realistの「searchでは静かに消える」注記も仕様に反映） |
| 13 | mergeable=CONFLICTING の `⚠ conflict` バッジ（UNKNOWN は非表示） | daily-user（案2から。低コストのため採用） |
| 14 | 実機 fixture 採取と contract test の制度化 | maintainer / daily-user |

---

## 1. CLIサーフェス完全定義

### コマンド体系
```
ghd                    # デフォルト。3セクションのダッシュボードを表示して即終了
ghd review  (ghd r)    # レビュー待ちセクションのみ
ghd pr      (ghd p)    # 自分のPRセクションのみ
ghd issue   (ghd i)    # アサインIssueセクションのみ
```
- サブコマンドは先頭一致で解決（`r`/`re`/`rev`… すべて review）。曖昧一致は発生しない（r/p/i で先頭文字が全て異なる）。
- **サブコマンド指定時は GraphQL クエリから該当しない search 節と変数を実際に削除して送信する**（絞ると本当に速くなる）。

### フラグ
| フラグ | デフォルト | 説明 |
|---|---|---|
| `--org <name>` | なし（全org） | 各検索クエリに `org:<name>` を付加。**繰り返し指定可**（複数 org: はGitHub search上OR）。 |
| `--limit <n>` | 10 | セクションあたり表示件数。範囲外は **黙って 1..50 にクランプ**（拒否しない）。GraphQL `first` にそのまま渡す。 |
| `--json` | off | 機械可読JSON（§5）。色・省略なし。エラーはstderr、stdoutは汚さない。 |
| `--no-color` | 自動判定 | 色抑止。優先順位: `--no-color` > `NO_COLOR` > `FORCE_COLOR=1` > isTTY判定。 |
| `--lang ja\|en` | 自動 | `--lang` > `GHD_LANG` > `LC_ALL`/`LANG` が `ja*` なら ja、他は en。 |
| `-h, --help` / `-V, --version` | — | 定番。 |

- フラグ解析は `node:util.parseArgs`。設定ファイルは読まない（起動時 fs I/O ゼロ）。
- タイムアウトは **10秒固定**（自前 `AbortSignal.timeout(10_000)` で gh 子プロセスを SIGTERM→SIGKILL）。
- 常に静的出力して即 exit。ページャなし・対話なし。`watch -c ghd` / `ghd | less` が自然に動く。

### デフォルト挙動の約束
- 引数なし実行が最速パス。設定不要、初回から動く。目標レイテンシ: node起動+gh spawn ≈ 60–100ms + API 1往復（300ms–1s）＝体感1秒前後。
- exit 0 は「表示成功」（0件でも、部分エラーでも取れた分を描画できれば 0）。

### v1 に入れないもの（明記）
- インタラクティブTUI・watchモード（`watch -c ghd` で代替）
- `ghd 488` / `--web` でブラウザを開く（v1.1最有力候補。`gh pr view -w` で代替）
- メンション・通知セクション（notifications APIはノイズ比が高く別設計）
- チーム宛レビュー依頼の展開（`review-requested:@me` はチーム宛も返す。v1は個人と同列表示＝見落としより過剰表示が安全、と README に明記）
- キャッシュ/オフライン/SWR表示、設定ファイル、Projects(V2)、複数アカウント、ページネーション
- GitHub Enterprise Server 対応（`GH_HOST` は gh に透過するが動作保証しない）

---

## 2. データ取得: gh API 呼び出しの具体定義

### 呼び出し形（常に1回、execFile・shell:false・クエリはstdin渡し）
```
gh api graphql \
  -F limit=10 \
  -f reviewQ='is:open is:pr review-requested:@me draft:false archived:false sort:updated-desc' \
  -f mineQ='is:open is:pr author:@me archived:false sort:updated-desc' \
  -f issueQ='is:open is:issue assignee:@me archived:false sort:updated-desc' \
  -f query=@-        # GraphQL文書はstdinで渡す（シェルエスケープ事故の根絶）
```
- **`-F limit=10`**: Int変数は必ず `-F`（`-f` は全て文字列になり型エラー）。
- `--org cureapp` 指定時は各検索文字列に ` org:cureapp` を付加（複数指定なら複数付加）。
- `sort:updated-desc` を**必ず**含める（best-match順だと first:N 切り詰めで「今朝動いたPR」が静かに消える）。
- サブコマンド絞り込み時は不要な alias・変数をクエリ文書から除去して送る。

### GraphQL 本体（フル版）
```graphql
query Dashboard($reviewQ: String!, $mineQ: String!, $issueQ: String!, $limit: Int!) {
  reviewRequested: search(query: $reviewQ, type: ISSUE, first: $limit) {
    issueCount
    nodes { ... on PullRequest {
      number title url isDraft updatedAt
      repository { nameWithOwner }
      author { login }
    } }
  }
  myPRs: search(query: $mineQ, type: ISSUE, first: $limit) {
    issueCount
    nodes { ... on PullRequest {
      number title url isDraft updatedAt reviewDecision mergeable
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup {
        state
        contexts(first: 50) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        }
      } } } }
    } }
  }
  assigned: search(query: $issueQ, type: ISSUE, first: $limit) {
    issueCount
    nodes { ... on Issue {
      number title url updatedAt
      repository { nameWithOwner }
      labels(first: 10) { nodes { name } }
    } }
  }
  rateLimit { cost remaining resetAt }
}
```

### CI状態の解釈規則（derive.ts、案2から全面移植）
1. `statusCheckRollup` が null、または `commits.nodes` が空（force-push直後）→ 状態 `none`（グリフ `–` dim）。fail/pending と絶対に混同させない。
2. contexts の各ノード:
   - CheckRun: `status !== "COMPLETED"` → 実行中。完了後は `conclusion` で判定 — `NEUTRAL`/`SKIPPED`/`SUCCESS`=非失敗、`FAILURE`/`TIMED_OUT`/`CANCELLED`/`ACTION_REQUIRED`/`STARTUP_FAILURE`=失敗（名前を収集）、`STALE`=pending。
   - StatusContext: `state` が `FAILURE`/`ERROR`=失敗、`PENDING`=実行中、`SUCCESS`=非失敗。
3. 同名チェック（re-run由来の重複）は name/context キーで**後勝ち dedupe**。
4. `contexts.totalCount > 50` のとき失敗名リストは不完全とみなし「他にも失敗あり」を付記（totalCount を取って初めて「拾えなかった」ことを検知できる）。
5. 全体状態は `rollup.state`: SUCCESS=`pass` / FAILURE・ERROR=`fail` / PENDING・EXPECTED=`pending`。
6. `reviewDecision`: APPROVED=「approved」/ CHANGES_REQUESTED=「要修正」/ REVIEW_REQUIRED=「approve待ち」/ **null（レビュー必須でないリポジトリ）= 状態語を出さない**（「approve待ち」と嘘をつかない）。
7. `mergeable`: CONFLICTING → `⚠ conflict`。UNKNOWN（GitHub側非同期計算中）→ 非表示、リトライしない。

### Issue優先度
ラベル名を `/^P\d$/i` または `priority:` プレフィックスでヒューリスティック抽出。なければラベル非表示。

### レート制限・コスト
- このクエリの実測コストは 1–3pt（5000pt/h 上限）。毎分実行しても余裕。
- `rateLimit.remaining < 100` のときのみ stderr に警告1行。
- `RATE_LIMITED` エラー時は `resetAt` をローカル時刻で「HH:mm に回復します」→ exit 6。

### 認証の事前チェックはしない（楽観方式）
`gh auth status` を事前に呼ばない（毎回150ms損）。本クエリを撃ち、失敗時に §6 の判定順序でエラー種別へマップする。

---

## 3. モジュール構成とファイルレイアウト

```
src/
  cli.ts          エントリ。parseArgs → 依存組み立て(composition root) → main()。ロジックなし
  gh.ts           GhRunner インターフェース + 実装。execFile("gh",[...], {shell:false})、
                  stdin書き込み、10s AbortSignal、SIGTERM→SIGKILL
  query.ts        GraphQL文書ビルダー（セクション取捨）+ 検索文字列ビルダー（純粋関数）
  parse.ts        生JSON → 正規化前ノード列。ノード単位の寛容パース:
                  nodes の null 除去 / 必須フィールド欠落ノードは skip + 警告カウント /
                  author null は Optional。手書きバリデータ（依存ゼロ、zodは入れない）
  derive.ts       rollup解釈・reviewDecision解釈・優先度抽出・ソート（全部純粋関数）
  model.ts        型定義: Dashboard, PrItem{ci:"pass"|"fail"|"pending"|"none", ...}, IssueItem, Warning
  errors.ts       GhdError(kind判別union) + kind→メッセージキー+exit code対応表
  i18n.ts         ja/en 文字列テーブル（キー完全一致をテストで強制。i18nライブラリ不使用）
  render/
    render.ts     Dashboard → string。レイアウト決定（固定幅バッジ域・カラム・省略・縮退）
    json.ts       安定JSON（schemaVersion付き）
    ansi.ts       8色+bold+dimのみ。無効化条件はここに集約
    time.ts       相対時刻。now を引数注入
    width.ts      East Asian Width 簡易実装（全角=2、約40行）。truncate/pad
test/
  fixtures/*.json 実APIレスポンス録画（正常/0件/rollup null/nodes null混入/部分エラー/SAML等）
dist/
  ghd.mjs         esbuildで単一ファイルバンドル（shebang付与、node_modules解決コストゼロ）
```

- **ランタイム依存: ゼロ**。devDeps は typescript / vitest / esbuild / tsx のみ。
- 副作用境界は `GhRunner` の1つだけ。時刻(now)・端末幅(width)・色(color)・言語(lang)はすべて引数注入。
- ベース案の fetch.ts は「パースと正規化の同居」批判を受けて parse.ts / derive.ts に分割。

---

## 4. モック・テスト戦略（vitest）

1. **ghモック**: `interface GhRunner { exec(args: string[], opts: {stdin?: string; timeoutMs: number}): Promise<{stdout; stderr; code}> }`。`FakeGhRunner` は「argsマッチャ → fixture応答」のテーブル駆動。テストで gh 本体は一切起動しない。
2. **fixture採取の制度化**: `npm run fixtures:record` で実 `gh api graphql` の出力を `test/fixtures/` に録画するスクリプトを同梱。採取時の gh バージョン・rateLimit cost・実測レイテンシを fixture 冒頭コメントと README に記録（案3の実測姿勢の制度化）。
3. **parse.ts / derive.ts**: fixture駆動ユニットテスト。nodes null混入・ghost author・rollup null・commits空配列・totalCount>50・同名チェック重複・EXPECTED/STALE を必ずケース化。
4. **render はスナップショットテスト**: width=80/50固定 × 色ON/OFF × ja/en × now固定で `toMatchSnapshot`。0件時・全0件時・警告フッタ付きも対象。
5. **query.ts / time.ts / width.ts は純粋関数ユニットテスト**: セクション取捨後のクエリ文書整合（不要なフラグメント・変数が残らないこと）、--org複数付加、全角混在truncate、59分/25時間/8日境界。
6. **--json の契約テスト**: 出力を自前スキーマ検証関数に通し schemaVersion 契約を自己検証。
7. **i18nキー網羅テスト**: ja/en のキー完全一致を強制。
8. **contract test**: `GHD_CONTRACT_TEST=1 vitest run contract` で実ghを叩く。CIでは **required にしない別ジョブ（週次スケジュール実行）** として登録し、gh/API劣化の継続検知経路を持つ（「E2EをCIで回さない」批判の解消）。

---

## 5. 出力設計

### セクション順序 = 行動優先度
1. レビュー待ち（他人をブロック＝最優先） 2. 自分のPR 3. アサインIssue

### カラムレイアウト（固定幅バッジ域 — 縦整列崩壊の解消）
自分のPRセクションの各行は固定幅カラム:
```
␣␣#番号(6) │ CIバッジ(9セル固定) │ 詳細(14セル固定) │ タイトル(flex) │ repo(dim) │ 時刻(dim,右端)
```
- CIバッジ: `✓ pass` / `✗ fail` / `● run` / `–` / `● draft` を9セル固定幅にpad。
- 詳細列(14セル固定)は**1つだけ**表示。優先順位: CI失敗チェック名（14セルに `…` 切り詰め、totalCount超過や2件以上は末尾 `+`）＞ `⚠ conflict` ＞ レビュー状態語。draft時は空。
- タイトル開始位置は行によらず一定。「#番号とバッジが縦に揃う」原則を可変長テキストが壊さない。
- draft PR は `● draft` のみ表示し **CI結果・レビュー状態を出さない**（draftのCI失敗はまだアクションではない。赤=即アクションの信頼性を守る）。

### 出力例（ja / TTY / width=80）
```
▶ レビュー待ち (2)
  #482  feat: sync retry                          cureapp/api        2h前
  #479  fix: token refresh                        cureapp/app        1d前

▶ 自分のPR (3)
  #488  ✓ pass     approve待ち     feat: retry queue       cureapp/api    3h前
  #485  ✗ fail     test/unit…+     fix: flaky spec         cureapp/api    5h前
  #481  ● draft                    chore: bump deps        cureapp/app    2d前

▶ アサインIssue (1)
  #77   ログにノイズが多い  P2                    cureapp/api        6d前
  … 他 4 件 (--limit 30 で表示)
```

### 0件時の出力例
```
▶ レビュー待ち (0)
  なし

▶ 自分のPR (1)
  #481  ● draft                    chore: bump deps        cureapp/app    2d前

▶ アサインIssue (0)
  なし
```
全セクション0件時:
```
▶ レビュー待ち (0)
▶ 自分のPR (0)
▶ アサインIssue (0)

今やるべきことはありません。
```
セクションは0件でも消さない（消えると「取得失敗？」と不安になる）。exit 0。

### 色の意味論
- 緑 `✓`/approved=良好。赤 `✗`/要修正=要アクション。黄 `●`/pending/3日超の時刻=進行中・注意。dim=メタ情報（repo・時刻・件数・省略行・`–`）。太字=セクションヘッダと `#番号` のみ。タイトル本文は無着色。
- 8色ANSI+bold/dimのみ（256色/truecolor不使用）。

### 幅と縮退
- `process.stdout.columns ?? 80`。タイトルは East Asian Width（全角=2）で `…` 省略。折り返し禁止＝1行1アイテム厳守。
- <60桁: repo列を落とす。<40桁: 時刻列も落としタイトル最優先。
- **非TTY（パイプ時）: 色なし・省略なしのタブ区切りに自動切替**（grep/awk耐性）。
- タイトル・ラベルから C0/C1 制御文字と ESC を必ず strip（ANSIインジェクション防御。テストケースあり）。

### --json（schemaVersion契約、v1で凍結）
```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-10T09:00:12+09:00",
  "reviewRequests": [
    {"number":482,"title":"feat: sync retry","repo":"cureapp/api",
     "url":"https://github.com/cureapp/api/pull/482","author":"alice","updatedAt":"..."}
  ],
  "myPullRequests": [
    {"number":488,"title":"feat: retry queue","repo":"cureapp/api","url":"...",
     "draft":false,"ci":"pass","ciFailedChecks":[],"ciMoreFailures":false,
     "review":"waiting","conflict":false,"updatedAt":"..."}
  ],
  "assignedIssues": [
    {"number":77,"title":"ログにノイズが多い","repo":"cureapp/api","url":"...",
     "labels":["P2"],"updatedAt":"..."}
  ],
  "totals":{"reviewRequests":2,"myPullRequests":3,"assignedIssues":5},
  "warnings":[{"kind":"parse_skipped","count":1}]
}
```
- `ci`: `"pass"|"fail"|"pending"|"none"`、`review`: `"approved"|"changes_requested"|"waiting"|null` で凍結。
- 生GraphQLでなく正規化済みモデルを出す。フィールド追加=minor、削除・改名=schemaVersionインクリメント。JSONキーは常に英語。

### i18n
ラベル文字列のみ i18n.ts のテーブル引き。記号・レイアウトは言語共通。データ（タイトル・repo名）は無加工。

---

## 6. エラーハンドリング表（判定順序どおり・すべてstderrに1〜3行「原因→次の一手」）

| 順 | 状況 | 検出シグナル | メッセージ例（ja） | exit |
|---|---|---|---|---|
| 1 | gh 未インストール | execFile ENOENT | `gh が見つかりません。https://cli.github.com からインストールしてください` | 127 |
| 2 | gh が古い | stderr に unknown command (graphql) | `gh 2.x へのアップデートが必要です` | 1 |
| 3 | タイムアウト | 自前10秒 AbortSignal | `10秒でタイムアウトしました。ネットワークを確認してください` | 5 |
| 4 | 部分エラー | stdout に data+errors 併存（`gh api graphql` は exit≠0 でも stdout に data を返す。**先に stdout をパースしてから判断**） | 取れたセクションは通常描画し、末尾に dim で `⚠ 一部のリポジトリにアクセスできませんでした` | 0 |
| 5 | レート制限 | errors[].type == RATE_LIMITED（data 実質なし） | `APIレート制限中。HH:mm に回復します`（resetAtをローカル時刻で） | 6 |
| 6 | 未認証 | **多重シグナル**: gh exit 4 **または** stderr に `gh auth login` / HTTP 401（exit code 単独に依存しない） | `GitHub に未認証です。まず: gh auth login` | 3 |
| 7 | SAML 未認可 | stderr に `SAML enforcement`（注: search では未認可orgは通常「静かに消える」ため主に明示403時のみ発火。README に明記） | `組織のSSO認可が必要です: gh auth refresh を実行してください` | 3 |
| 8 | 権限不足 | HTTP 403（レート以外） | `トークンの権限不足です: gh auth refresh -s repo,read:org` | 3 |
| 9 | ネットワーク断 | stderr に getaddrinfo/ECONNRESET/ETIMEDOUT/`error connecting` | `GitHub に接続できません（オフライン？）` | 4 |
| 10 | パース不能ノード | parse.ts の寛容パースで skip | 描画は継続し末尾に `⚠ N件を解析できませんでした`（クラッシュさせない） | 0 |
| 11 | 使い方誤り | parseArgs 例外・未知サブコマンド | usage 1画面 | 2 |
| 12 | その他予期しない失敗 | 上記以外 | gh stderr 要約1行 + `予期しないエラーです` | 1 |

`--json` 時もエラーはstderrテキスト（stdoutを汚さない）。警告(4,10)は `--json` では `warnings` 配列に格納。

## 7. 終了コード一覧

| code | 意味 |
|---|---|
| 0 | 表示成功（0件・部分エラーで一部描画できた場合を含む） |
| 1 | 予期しないエラー / gh が古い / API全滅 |
| 2 | 使い方誤り（usage） |
| 3 | 認証（未認証・SAML・スコープ不足） |
| 4 | ネットワーク断 |
| 5 | タイムアウト |
| 6 | レート制限 |
| 127 | gh 不在（コマンド不在のシェル慣習） |

---

## 8. エッジケース一覧

- **0件セクション**: ヘッダ+dim「なし」。全0件は「今やるべきことはありません。」1行。exit 0。
- **大量件数**: `first:$limit` で切り、`issueCount` 差分を `… 他 N 件 (--limit 30 で表示)` と次アクション付きで表示（追加リクエスト不要）。`sort:updated-desc` により切り詰めても直近更新分は漏れない。
- **アーカイブ済みリポジトリ**: `archived:false` でサーバ側除外。
- **CI未設定 / commits空（force-push直後）**: `–`(dim)。fail と混同させない（fixtureテストで固定）。
- **rollupあるがcontexts空 / state=EXPECTED / STALE**: pending 扱い。
- **失敗チェック名が first:50 の外**: `totalCount` で検知し名前なし `✗ fail` +「他にも失敗あり」。嘘の名前を出さない。
- **同名チェックのre-run重複**: 後勝ちdedupe。
- **nodes の null 要素・ghost author(null)・アクセス喪失リポジトリ**: skip+Optional化+警告カウント。クラッシュさせない。
- **reviewDecision null（レビュー必須でないリポジトリ）**: 状態語を出さない。
- **mergeable UNKNOWN**: 非表示・リトライなし。CONFLICTING のみ `⚠ conflict`。
- **チーム宛レビュー依頼**: v1は個人と同列表示。「自分のPR」との重複掲載も許容（両方の文脈で意味がある）。
- **searchインデックス遅延**: 直近数十秒の変更が反映されないことがある旨を README に明記（v1では回避しない）。
- **狭い端末**: <60桁でrepo列、<40桁で時刻列を段階ドロップ。折り返し禁止。
- **制御文字入りタイトル**: strip（ANSIインジェクション対策）。絵文字・サロゲートペアの途中で切らない。
- **時計ずれ（updatedAtが未来）**: 「今」と表示。
- **パイプ利用**: 非TTYで自動的に色なしタブ区切り。

---

## 9. ビルド・配布

- esbuild で `dist/ghd.mjs` 単一ファイル（shebang付与）。ランタイム依存ゼロ、node_modules 解決コストゼロ。
- README に記録する実測値: gh バージョン、rateLimit cost、起動〜描画レイテンシ（fixture採取時に更新）。

---

## 付録: TDD実装順序

TDD推奨実装順序（各ステップ「テスト先行→実装→グリーン」で進める）:

1. **width.ts / render/time.ts** — 依存ゼロの純粋関数から。全角混在truncate、サロゲートペア境界、59分/25時間/8日境界、未来時刻(「今」)のテストを先に書く。
2. **query.ts** — 検索文字列ビルダー（draft:false・sort:updated-desc・--org複数付加）と GraphQL文書ビルダー（サブコマンドによる search節/変数/フラグメントの取捨で残骸が残らないこと）をユニットテストで固定。
3. **fixture採取** — `npm run fixtures:record` を作り、実ghで正常系/0件/rollup null/commits空/nodes null混入/部分エラー のfixtureを録画・チェックイン（gh バージョンと cost をコメント記録）。以降のテストは全てこのfixtureを使い実ghを叩かない。
4. **parse.ts** — 寛容パース。null除去・ghost author・欠落フィールドskip+警告カウントをfixture駆動でテスト。
5. **derive.ts** — CI解釈テーブル（2段判定・dedupe・totalCount>50検知・EXPECTED/STALE丸め）、reviewDecision/mergeable解釈、優先度ラベル抽出。仕様書§2の解釈規則を1ケース1テストで網羅。
6. **model.ts / i18n.ts** — 型定義と ja/en テーブル。キー完全一致テスト。
7. **render/render.ts + ansi.ts** — スナップショットテスト（width 80/50 × 色ON/OFF × ja/en × now固定）。固定幅バッジ域の縦整列、0件時・全0件時・警告フッタ・非TTYタブ区切りを含める。
8. **render/json.ts** — schemaVersion契約の自己検証テスト。
9. **errors.ts** — §6の判定順序をテーブル駆動テスト（fixtureのstderr文字列を使用）。exit code対応を固定。
10. **gh.ts + FakeGhRunner** — GhRunner境界、stdin渡し、10sタイムアウトのSIGTERM/SIGKILL（fakeタイマーで）。
11. **cli.ts 統合** — FakeGhRunner差し替えのE2E風テスト（引数→exit code→stdout/stderr の全経路: 正常/部分エラー/認証/ネットワーク/レート/usage）。
12. **ビルドと contract test** — esbuild単一ファイル化、`GHD_CONTRACT_TEST=1` の実gh契約テストをCIの非required週次ジョブとして登録。実測レイテンシ・costをREADMEに記録して完成。

依存方向は 1→11 で一方向（純粋関数コア→副作用シェル）なので、この順で進めると常に下層がテスト済みの状態で上層を書ける。
