# StoryDeck — Public Version Discipline

This repo (`coco-research/storydeck`) is the **public, open version of the product**.
This laptop is the **private "first user" instance**. Both share the same code; only
the *data* differs. Every loop tick and every commit MUST preserve this separation.

## The two worlds

| | Public repo (`coco-research/storydeck`) | This laptop (private instance) |
|---|---|---|
| Purpose | Generic product anyone can clone & run | Rijul's real board (dogfooding) |
| Code | ✅ committed | ✅ same code |
| Seed | `data/seed.sample.json` (demo, fake) | `data/seed.json` (real, **gitignored**) |
| DB | none (created on first run) | `data/todo.db` (**gitignored**) |
| Backups | none | `backups/*.json` (**gitignored**) |
| Secrets | `env.example` only | `.env` with real key (**gitignored**) |
| Branding | `BOARD_TITLE` defaults to "StoryDeck" | `.env` sets `BOARD_TITLE="Rijul's Stories"` |

## Hard rules (never violate)

1. **Never commit real data.** `data/seed.json`, `data/*.db`, `data/*.db-*`,
   `backups/`, and `screenshots/` are gitignored. Do not `git add -f` them.
2. **Never commit secrets.** `.env` is gitignored; only `env.example` (empty key)
   is public. The `CURSOR_API_KEY` never leaves this machine.
3. **No personal identity in code.** No real names, McKinsey/vendor names, invoice
   numbers, emails, or internal project names in committed files. Branding is
   generic ("StoryDeck") and configurable via `BOARD_TITLE`.
4. **Tests run on the sample seed.** `test/*` seed from `data/seed.sample.json` so a
   clean clone is green with zero private data. Assertions must match the sample,
   not the private board.
5. **Sample seed is fictional.** `seed.sample.json` contains only made-up demo
   stories (Website / Mobile / Marketing / Ops / Personal / GitHub epics).

## When adding a feature (loop cadence)

- Build it generically so a stranger cloning the repo can use it.
- If it needs example data, add it to `seed.sample.json` (fictional only).
- Keep `node --test` green against the sample.
- Update `README.md` if user-facing behavior changes.
- Commit code-only. Push to `coco-research/storydeck` **only when explicitly asked**
  and only after confirming the tracked set has no private data:
  `git status` + `git ls-files | grep -E 'seed\.json|\.db|backups/|\.env$'` → must be empty.

## Access note

Pushing requires the authenticated GitHub account to have write access to
`coco-research/storydeck`. If `git push` returns "Repository not found", the
account lacks access — grant it, then retry. Never work around this by changing
the remote to a personal repo without asking.
