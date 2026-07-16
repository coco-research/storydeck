# Contributing to StoryDeck

Thanks for your interest! StoryDeck is a small, dependency-light, local-first
app, and contributions that keep it that way are very welcome.

## Getting started

```bash
git clone https://github.com/coco-research/storydeck.git
cd storydeck
npm install          # Electron (for the desktop window) is the only dep
npm start            # local web server → http://127.0.0.1:4321
npm run app          # or run the Electron desktop window
npm test             # node --test — unit, API, and frontend tests
```

No build step and no framework: the frontend is a single `web/index.html`, the
backend is plain Node with the built-in `node:sqlite`.

## Ground rules

- **Local-first stays local-first.** Don't add cloud services, telemetry, or new
  network egress. The only outbound call is the optional AI assistant via
  `/api/chat`. See [`SECURITY.md`](SECURITY.md).
- **Keep dependencies minimal.** Prefer the Node standard library. Adding a
  runtime dependency needs a good reason.
- **Tests must stay green** (`npm test`) and seed from the committed public
  sample (`data/seed.sample.json`) so the suite is deterministic in any clone.
  Add tests for new behavior.
- **Never commit secrets or personal data.** `.env`, API keys, real seeds,
  databases, and backups are gitignored — keep it that way.

## Making a change

1. Fork and branch from `main`.
2. Make your change; add or update tests.
3. Run `npm test` — all tests must pass.
4. Keep commits focused and messages descriptive (imperative mood, e.g.
   "add status filter to list view").
5. Open a pull request describing the change and why. Screenshots help for UI
   changes (capture them from the public sample data, not private boards).

## Style

- Match the surrounding code; no reformatting-only diffs.
- Comments should explain *why*, not narrate *what*.
- Frontend: keep it framework-free and accessible (ARIA + keyboard support).

## Reporting bugs / ideas

Open a GitHub issue with clear steps to reproduce (for bugs) or the problem
you're trying to solve (for features). For security issues, follow
[`SECURITY.md`](SECURITY.md) instead of filing a public issue.
