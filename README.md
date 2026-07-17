# ghd — GitHub work dashboard CLI

English | [日本語](./README.ja.md)

Type `ghd` in your terminal and see everything on GitHub that needs your attention — one screen, one second.

```
▶ Review requests (2)
  #482   feat: sync retry                            cureapp/api    2h ago
  #479   fix: token refresh                          cureapp/app    1d ago

▶ My PRs (3)
  #488   ✓ pass    needs review   feat: retry queue  cureapp/api    3h ago
  #485   ✗ fail    test/unit+     fix: flaky spec    cureapp/api    5h ago
  #481   ● draft                  chore: bump deps   cureapp/app    2d ago

▶ Assigned issues (1)
  #77    Noisy logging       P2  [In Progress]       cureapp/api    6d ago
```

Top-to-bottom order **is** action priority: who is waiting on you → what is broken → what to do next.

## Features

- **One API round-trip**: three searches bundled into a single aliased GraphQL request (measured cost: 1pt out of 5,000pt/h)
- **Fast**: zero runtime dependencies + single-file esbuild bundle. Measured startup overhead ~30ms
- **Resilient**: lenient per-node parsing — one malformed PR never takes down the whole dashboard
- **Color = state**: red = action needed / green = good / yellow = in progress or stale >3 days / dim = metadata
- **CJK-aware**: East Asian Width handling keeps columns aligned even with Japanese titles
- **Pipe-friendly**: automatically switches to tab-separated output when not a TTY (`ghd | grep`, `ghd | awk -F'\t'`)

## Requirements

- [gh CLI](https://cli.github.com) 2.x, authenticated (`gh auth login`)
- Node.js 20+

## Install

```console
$ npm install -g ghd-cli    # installs the `ghd` command
```

Or from source:

```console
$ pnpm install && pnpm build
$ ln -s "$PWD/dist/ghd.mjs" ~/.local/bin/ghd   # anywhere on your PATH
```

## Usage

```console
$ ghd            # all three sections
$ ghd review     # review requests only (prefix match: ghd r)
$ ghd pr         # my PRs only (ghd p)
$ ghd issue      # assigned issues only (ghd i)
$ ghd 488        # open that PR/issue in the browser (non-TTY: print URL only)

$ ghd --org cureapp          # filter by organization (repeatable)
$ ghd --limit 30             # items per section (default 10, max 50)
$ ghd --count                # one-line counts: R2 P3 I1 (for prompts / tmux statuslines)
$ ghd --json | jq '.totals'  # machine-readable JSON (schemaVersion contract)
$ watch -c 'FORCE_COLOR=1 ghd'   # poor man's watch mode (with colors)
```

Language is resolved as `--lang ja|en` > `GHD_LANG` > `LC_ALL`/`LANG`. Color as `--no-color` > `NO_COLOR` > `FORCE_COLOR=1` > TTY detection.

`ghd <number>` searches all three sections in a single round-trip and opens the match. Browser selection: `BROWSER` env var > OS default (`open`/`xdg-open`/`start`). If the same number matches in multiple repositories, ghd lists the candidates instead of opening one.

## Reading the output

| Display | Meaning |
|---|---|
| `✓ pass` | CI green |
| `✗ fail` + check name | CI failed. `+` means more failures |
| `● run` | CI running |
| `–` | No CI configured (including right after a force-push) |
| `● draft` | Draft (CI/review state hidden: red on a draft is not an action yet) |
| `needs review` / `approved` / `changes req` | reviewDecision. Nothing is shown for repos that don't require reviews |
| `⏎ ready` | CI green + approved + no conflicts. Just merge it (floats to the top of the section) |
| `⚠ conflict` | Merge conflict |
| `[In Progress]` etc. | The Projects V2 `Status` column the issue is on (needs the `read:project` scope; without it the column is omitted and a hint is shown) |

## Exit codes

| code | meaning |
|---|---|
| 0 | Rendered successfully (including zero items and partial errors with partial output) |
| 1 | Unexpected error / gh too old |
| 2 | Usage error |
| 3 | Authentication (not logged in / SAML / missing scopes) |
| 4 | Network unreachable |
| 5 | Timeout (fixed 10s) |
| 6 | API rate limited |
| 127 | gh not found |

## Development

```console
$ pnpm test              # unit + snapshot tests (no gh, no network)
$ pnpm typecheck
$ pnpm build             # single-file dist/ghd.mjs
$ pnpm test:contract     # contract tests against the real gh (GHD_CONTRACT_TEST=1)
$ pnpm fixtures:record   # record real API responses into test/fixtures/live-full.json
```

The full design history lives in [docs/SPEC.md](docs/SPEC.md) (Japanese; the outcome of a three-proposal design competition reviewed by three judges).

### Measurements (gh 2.87.3, taken 2026-07-10)

- GraphQL query cost: **1pt** (measured via rateLimit.cost)
- Startup overhead (`ghd -V`): **~30ms**
- Perceived latency incl. one real API round-trip: **~1–3s** (dominated by GitHub search API latency)

## Intentionally out of scope

- Interactive TUI / watch mode (use `watch -c 'FORCE_COLOR=1 ghd'`)
- Notification / mention sections
- Separating team review requests (`review-requested:@me` includes team requests; showing them inline is safer than missing them)
- GitHub Enterprise Server support guarantees
- Note: the GitHub search index can lag behind by up to a few dozen seconds

## License

MIT
