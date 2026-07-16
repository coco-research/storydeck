# Security Policy

StoryDeck is **local-first by design**. Understanding its trust model is the best
way to reason about security.

## Where your data lives

- The board, comments, and backups are stored in a **local SQLite file** on your
  own machine (`data/todo.db`, or the OS user-data folder for the packaged app).
- The web server binds to **`127.0.0.1` only** — it is not reachable from your
  network or the internet.
- There is **no telemetry and no cloud sync**. Nothing is uploaded anywhere.

## The one network egress: the AI assistant

The only outbound network call is the **optional** AI assistant. When enabled, a
compact snapshot of your board is sent to the provider you configured (OpenAI,
Anthropic, or Cursor) through the single local `/api/chat` endpoint.

- Your API key is read server-side from `.env` or from a first-run key file
  (`ai-config.json`) stored **next to the database, never in the repo**.
- The key is **never** sent to the browser, logged, or echoed back by any
  endpoint (including `/api/ai/health`).
- With no key configured, the app runs **fully offline**.

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead,
open a [GitHub security advisory](https://github.com/coco-research/storydeck/security/advisories/new)
or email the maintainers privately. Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal case if possible),
- the affected version/commit.

We aim to acknowledge reports within a few days and will keep you updated on a
fix. Please give us reasonable time to address the issue before any public
disclosure.

## Supported versions

This is an actively developed project; fixes land on `main`. Please verify an
issue against the latest `main` before reporting.
