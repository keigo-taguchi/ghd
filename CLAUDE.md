# ghd 開発ガイド

GitHub作業ダッシュボードCLI。設計の全記録は docs/SPEC.md（v1確定仕様）、ユーザー向けは README.md（英語が正・README.ja.md と両方更新すること）。

## 設計原則（変更は原則これに従う。破る場合は理由をコミットメッセージに書く）

1. **API 1往復**: gh の呼び出しは常に1回。aliased GraphQL で束ねる。例外は read:project スコープ欠如時の縮退リトライ（main.ts）のみ
2. **出力の上から順 = 行動優先度**: セクション順・セクション内の並び替え（merge可の浮上など）はこの原則で決める
3. **色 = 状態の意味の一対一**: 赤=要アクション / 緑=良好 / 黄=進行中・放置 / dim=メタ。任意文字列（プロジェクト列名など）には色を付けない
4. **嘘をつかない**: 確信が持てない状態は表示しない。例: `ready`（merge可）は ci=none や mergeable=UNKNOWN を偽陽性にしない。reviewDecision null は状態語を出さない
5. **落ちない**: parse.ts はノード単位の寛容パース。1つの変なノードで全画面をクラッシュさせない。スキップは警告カウント
6. **ランタイム依存ゼロ + 起動時 fs I/O ゼロ**: 設定ファイルは読まない。バージョンは src/version.ts にハードコード
7. **パイプ対応**: 非TTYは TSV（7列固定契約）。--json は schemaVersion 契約（フィールド追加=minor / 削除・改名=schemaVersion増分）

## アーキテクチャ（層を跨ぐ実装をしない）

```
cli.ts        composition root。本物の副作用を組み立てて run() に渡すだけ
main.ts       オーケストレーション。副作用は Deps 経由のみ（テストは Fake 注入）
query.ts      検索クエリ・GraphQL文書のビルダー（純粋関数）
gh.ts         gh プロセス起動の副作用境界（spawn はここと browser.ts のみ）
browser.ts    ブラウザ起動の副作用境界
parse.ts      stdout → 生ノード（寛容パース・手書きバリデータ・zod禁止）
derive.ts     生ノード → ドメインモデル（純粋関数。CI解釈・ready合成・並び替え）
render/       モデル → 文字列（純粋関数。レイアウト決定はすべてここ）
i18n.ts       ja/en 文字列テーブル（キーは両言語で完全一致。テストで強制）
errors.ts     失敗分類と終了コード（0-6, 127。README の表と同期）
```

## ハマりどころ（実測で確認済みの事実）

- **gh api graphql**: Int 変数は `-F`（`-f` は文字列で型エラー）。`query=@-`（stdin参照）も `-F` のみ有効
- **GitHub search に `number:` 修飾子はない**。裸の番号は該当番号の Issue/PR に一致する（`ghd <番号>` はこれを利用し、テキスト一致混入は number 完全一致で除去）
- **search クエリは `sort:updated-desc` 必須**（best-match 順だと first:N 切り詰めで最近の項目が消える）
- **INSUFFICIENT_SCOPES はクエリ全体を拒否**（部分 null ではない）。フィールド追加でスコープ要件が増える場合は縮退リトライを設計すること
- **スナップショット更新は `pnpm exec vitest run -u`**（`pnpm test -- -u` は引数が届かない）
- **フィクスチャの nodes は sort:updated-desc 順を保つ**（実APIの並びを模倣。並び替えロジックのテストが意味を持つように）
- 全角幅は render/width.ts の East Asian Width 実装で計算。新しいバッジ記号（⏎ ⚠ ● など）は曖昧幅に注意
- 狭い端末の縮退順: repo縮小 → repo → 時刻。注釈系の列（プロジェクト列）は幅60未満で列ごと落とす

## 変更時のチェックリスト

- 表示に新しい状態・列を足したら: model.ts → derive.ts → render/render.ts（TTY・TSV両方）→ render/json.ts → i18n.ts（**ja/en 両方**）→ README.md と README.ja.md の「表示の読み方」表
- クエリを変えたら: `pnpm test:contract`（実APIで rateLimit.cost を確認。1pt想定・3pt超は重くなった兆候）
- バージョンを上げたら3箇所同期: package.json / src/version.ts / test/main.test.ts の `-V` 期待値
- コミット前: `pnpm typecheck && pnpm test && pnpm build` + 実機確認（`node dist/ghd.mjs`）

## ワークフロー

- **main は保護されている**: 直接 push 不可。ブランチ → PR → CI（必須チェック `test`）→ マージ
- **マージは merge commit**（`gh pr merge --merge`）。squash はコミット単位の履歴が潰れるので使わない。rebase はルールで不許可
- **コミットは機能単位で分割**。メッセージは日本語 + conventional prefix（feat/fix/chore/docs）。「なぜ」を本文に書く
- npm パッケージ名は `ghd-cli`（無印 ghd は取得済み）、bin 名は `ghd`。publish は prepublishOnly が typecheck+test+build を強制
- リリース手順は `.claude/skills/release/SKILL.md` を参照
