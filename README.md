# ghd — GitHub作業ダッシュボードCLI

ターミナルで `ghd` と打つと、GitHub上の「今やるべきこと」を1画面・1秒で把握できるCLIツール。

```
▶ レビュー待ち (2)
  #482   feat: sync retry                            cureapp/api    2h前
  #479   fix: token refresh                          cureapp/app    1d前

▶ 自分のPR (3)
  #488   ✓ pass    approve待ち    feat: retry queue  cureapp/api    3h前
  #485   ✗ fail    test/unit+     fix: flaky spec    cureapp/api    5h前
  #481   ● draft                  chore: bump deps   cureapp/app    2d前

▶ アサインIssue (1)
  #77    ログにノイズが多い  P2                      cureapp/api    6d前
```

出力は上から順に**行動優先度**そのもの: 「誰を待たせているか」→「何が壊れているか」→「次に何をやるか」。

## 特徴

- **API 1往復**: 3つの検索を aliased GraphQL で1リクエストに束ねる（実測コスト 1pt / 5000pt/h）
- **速い**: ランタイム依存ゼロ + esbuild単一ファイルバンドル。起動オーバーヘッド実測 ~30ms
- **落ちない**: ノード単位の寛容パースで、1つの変なPRがダッシュボード全体を壊さない
- **色 = 状態の意味**: 赤=要アクション / 緑=良好 / 黄=進行中・3日超放置 / dim=メタ情報
- **全角対応**: East Asian Width で日本語タイトルも列が揃う
- **パイプ対応**: 非TTYでは自動でタブ区切りに切替（`ghd | grep`、`ghd | awk -F'\t'`）

## 必要なもの

- [gh CLI](https://cli.github.com) 2.x（認証済み: `gh auth login`）
- Node.js 20+

## インストール

```console
$ pnpm install && pnpm build
$ ln -s "$PWD/dist/ghd.mjs" ~/.local/bin/ghd   # PATHの通った場所へ
```

## 使い方

```console
$ ghd            # 3セクション全部
$ ghd review     # レビュー待ちのみ（先頭一致: ghd r でも可）
$ ghd pr         # 自分のPRのみ (ghd p)
$ ghd issue      # アサインIssueのみ (ghd i)

$ ghd --org cureapp          # 組織で絞り込み（繰り返し指定可）
$ ghd --limit 30             # セクションあたり表示件数（既定10・最大50）
$ ghd --json | jq '.totals'  # 機械可読JSON（schemaVersion契約つき）
$ watch -c 'FORCE_COLOR=1 ghd'   # 簡易watchモード（色付き）
```

言語は `--lang ja|en` > `GHD_LANG` > `LC_ALL`/`LANG` で自動判定。色は `--no-color` > `NO_COLOR` > `FORCE_COLOR=1` > TTY判定。

## 表示の読み方

| 表示 | 意味 |
|---|---|
| `✓ pass` | CI成功 |
| `✗ fail` + チェック名 | CI失敗。`+` は他にも失敗あり |
| `● run` | CI実行中 |
| `–` | CI未設定（force-push直後含む） |
| `● draft` | ドラフト（CI・レビュー状態は表示しない: draftの赤はまだアクションではない） |
| `approve待ち` / `approved` / `要修正` | reviewDecision。レビュー必須でないリポジトリでは何も出さない |
| `⚠ conflict` | マージコンフリクト |

## 終了コード

| code | 意味 |
|---|---|
| 0 | 表示成功（0件・部分エラーで一部描画できた場合を含む） |
| 1 | 予期しないエラー / gh が古い |
| 2 | 使い方誤り |
| 3 | 認証（未認証・SAML・スコープ不足） |
| 4 | ネットワーク断 |
| 5 | タイムアウト（10秒固定） |
| 6 | APIレート制限 |
| 127 | gh 不在 |

## 開発

```console
$ pnpm test              # ユニット+スナップショット（gh不要・ネットワーク不要）
$ pnpm typecheck
$ pnpm build             # dist/ghd.mjs 単一ファイル
$ pnpm test:contract     # 実ghを叩く契約テスト（GHD_CONTRACT_TEST=1）
$ pnpm fixtures:record   # 実APIレスポンスを test/fixtures/live-full.json に録画
```

設計の全記録は [docs/SPEC.md](docs/SPEC.md)（3案の設計コンペ → 3審査員 → 統合、の成果物）。

### 実測値（gh 2.87.3 / 2026-07-10 採取）

- GraphQL クエリコスト: **1pt**（rateLimit.cost 実測）
- 起動オーバーヘッド（`ghd -V`）: **~30ms**
- 実API 1往復込みの体感: **~1–3秒**（GitHub search APIのレイテンシが支配項）

## v1 のスコープ外（意図的に入れていないもの）

- インタラクティブTUI・watchモード（`watch -c 'FORCE_COLOR=1 ghd'` で代替）
- ブラウザで開く `--web`（v1.1候補。`gh pr view -w <num>` で代替）
- 通知・メンションセクション
- チーム宛レビュー依頼の分離表示（`review-requested:@me` はチーム宛も含む。v1では同列表示 = 見落としより過剰表示が安全）
- GitHub Enterprise Server 対応保証
- 注意: GitHub search インデックスの反映は直近数十秒遅れることがある

## License

MIT
