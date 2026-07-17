---
name: release
description: ghd の新バージョンをリリースする（バージョン同期 → PR → git タグ → GitHub Release → npm publish）。バージョンを上げたい・リリースしたい・npm に公開したいときに使う。
---

# ghd リリース手順

前提: main は保護されているため、すべての変更はブランチ → PR → CI（必須チェック `test`）→ merge commit で入れる。

## 1. バージョン決定

- 機能追加 = minor / バグ修正のみ = patch / --json の削除・改名 = schemaVersion 増分も伴う（render/json.ts）
- 現在のバージョンは `src/version.ts` を見る

## 2. バージョン同期（3箇所。手動同期が仕様 — 起動時 fs I/O ゼロ原則のため）

1. `package.json` の `version`
2. `src/version.ts` の `VERSION`
3. `test/main.test.ts` の `-V` テスト期待値

## 3. 検証してコミット・PR

```console
$ pnpm typecheck && pnpm test && pnpm build
$ node dist/ghd.mjs -V        # 新バージョンが出ることを確認
$ pnpm test:contract          # クエリを変えた場合のみ（実API・コスト1pt想定）
```

- コミットメッセージ: `chore: vX.Y.Z`（本文にリリース内容の要約）
- `gh pr create` → `gh pr checks <n> --watch` → `gh pr merge <n> --merge --delete-branch`
  （squash 禁止: コミット履歴が潰れる。rebase はリポジトリルールで不許可）

## 4. タグと GitHub Release

```console
$ git checkout main && git pull
$ git tag vX.Y.Z && git push origin vX.Y.Z
$ gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

単一ファイル配布も添付する場合: `pnpm build && gh release upload vX.Y.Z dist/ghd.mjs`

## 5. npm publish

```console
$ npm publish
```

- パッケージ名は `ghd-cli`（bin は `ghd`）。`prepublishOnly` が typecheck + test + build を自動実行するので、失敗したら publish は中断される
- 未ログインなら先にユーザー本人が `npm login`（ブラウザ認証・2FA）を行う必要がある
- 公開後の確認: `npm view ghd-cli version` と `npx -y ghd-cli@latest -V`

## 6. 事後確認

- README のインストール手順（`npm install -g ghd-cli`）が最新バージョンで動くこと
- リリースノートに breaking change がある場合は README.md / README.ja.md の該当箇所も更新済みか確認
