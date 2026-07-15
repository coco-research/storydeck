# StoryDeck — Public Version Discipline

This repo (`coco-research/storydeck`) is the **public, open version of the product**.
This laptop is the **private "first user" / McKinsey instance**. They share ONE
codebase; only the *data* differs, so they are **always in sync by construction**.

## Structure (overlay model — no code duplication)

```
ToDo/
  web/                    # frontend assets (was public/) — served by the server
  src/                    # server, db, ai, env
  data/seed.sample.json   # PUBLIC demo seed (fictional, committed)
  private/                # PRIVATE overlay (gitignored) — the McKinsey instance
    data/seed.json        #   real stories
    data/todo.db          #   live database
    backups/              #   snapshots
    .env                  #   CURSOR_API_KEY + BOARD_TITLE="Rijul's Stories"
```

- The app auto-detects `private/`. If present → reads/writes there (real data).
  If absent (a fresh public clone) → uses `data/` + the sample seed.
- `env.js` loads `private/.env` first, then a root `.env`.
- Branding: `BOARD_TITLE` defaults to "StoryDeck" (public); the private `.env`
  sets it to "Rijul's Stories".

## The two worlds

| | Public repo (pushed) | This laptop (private overlay) |
|---|---|---|
| Code | ✅ committed | ✅ identical code |
| Seed | `data/seed.sample.json` (fake) | `private/data/seed.json` (real) |
| DB / backups | none (runtime creates in `data/`) | `private/data/todo.db`, `private/backups/` |
| Secrets | `env.example` only | `private/.env` |
| Title | "StoryDeck" | "Rijul's Stories" |

## Hard rules (never violate)

1. **Never commit the private overlay.** `private/` is gitignored in full. Also
   never commit `data/*.db`, root `backups/`, or `.env`. Never `git add -f` them.
2. **Never commit secrets.** Only `env.example` (empty key) is public.
3. **No personal / client identity in committed code.** No real names, McKinsey or
   vendor names, invoice numbers, emails, or internal project names. Branding is
   generic and configurable via `BOARD_TITLE`.
4. **Tests run on the sample seed.** `test/*` seed from `data/seed.sample.json`
   so a clean clone is green with zero private data.
5. **Sample seed is fictional** (Website / Mobile / Marketing / Ops / Personal /
   GitHub epics). If a feature needs example data, add it here — fictional only.

## Commit + push workflow (auto, per change)

At the end of each change:
1. `node --test` must be green.
2. Safety check — this MUST return nothing:
   ```
   git ls-files | grep -E 'private/|seed\.json$|\.db$|\.db-|backups/|(^|/)\.env$'
   ```
3. Commit code-only locally, then push to `coco-research/storydeck` (`main`).

Push uses the `rijulkalra2000` GitHub account (it has write access; `rijul-mck`
does not). The global active `gh` account stays `rijul-mck` — pushes use that
account's token for this repo only, never changing the active account.
