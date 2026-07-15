# StoryDeck

A **local-first, retro-terminal Kanban board** for your stories, tasks, and epics.
Runs entirely on your machine — your data lives in a local SQLite file and never
leaves the device. Optional AI assistant, boot screen, dashboard, and three
selectable terminal themes (gruvbox / amber / green).

> **Privacy model:** StoryDeck is local-first by design. The board, comments, and
> backups are stored in `data/` on your disk. The only network egress is the
> optional AI assistant, which talks to a single `/api/chat` endpoint using a key
> you provide. No telemetry, no cloud sync.

---

## Features

- **Kanban board** — To Do / In Progress / Blocked / Done, drag-and-drop, reorder.
- **Epics** — group stories into projects; custom epics auto-become filter buttons.
- **Stories** — sprint points, notes, inline comments, urgent flag, per-story status.
- **Views** — full board, compact list, and a dashboard with counts + progress bars.
- **Search & prefilters** — filter by text or by status in either view.
- **Boot screen** — a BIOS/POST-style splash with a weekly standup summary.
- **AI assistant** *(optional)* — an agentic "ask" bar that can add, update, comment,
  complete, and focus the board via natural language.
- **Backup / Restore** — export or import the whole board as JSON.
- **Desktop app** — runs as an Electron window, or as a plain local web server.

## Quick start

```bash
# 1. Install (Electron is the only dependency, for the desktop window)
npm install

# 2. (Optional) enable the AI assistant
cp env.example .env         # then put your key in CURSOR_API_KEY=

# 3a. Run as a desktop app
npm run app

# 3b. …or run as a local web server and open the URL in a browser
npm start                   # http://127.0.0.1:4321
```

The server binds to `127.0.0.1` only — it is not reachable from the network.

## Data & seeding — public build vs. private overlay

StoryDeck keeps one codebase but walls off real data with a **`private/` overlay**:

- **Public build (this repo):** seeds from the fictional **`data/seed.sample.json`**.
  A fresh clone runs with demo data and commits nothing sensitive.
- **Private overlay (`private/`, gitignored):** if a `private/` folder exists, the
  app reads and writes there instead — `private/data/seed.json` (your real seed),
  `private/data/todo.db` (live DB), `private/backups/`, and `private/.env` (your key
  + `BOARD_TITLE`). Nothing under `private/` is ever committed or pushed.

Because both share the *same code*, the public and private versions are always in
sync by construction — only the data differs.

```
ToDo/
  web/                 # frontend assets served by the server
  src/                 # server, db, ai, env
  data/seed.sample.json  # PUBLIC demo seed (committed)
  private/             # PRIVATE overlay (gitignored) — real data, DB, backups, .env
```

## Download

Grab a prebuilt desktop app from the
[Releases page](https://github.com/coco-research/storydeck/releases) — macOS
(`.dmg`), Windows (`.exe`), or Linux (`.AppImage`). Download, run, and your board
saves automatically to your OS user-data folder. No setup, no server to start.

(Maintainers: push a `v*` tag to trigger the release build — see
`.github/workflows/release.yml`.)

## AI assistant (optional)

The ask bar works with **any one of three providers** — set the API key for the
one you use in `.env`. If several are set, the priority is OpenAI → Anthropic →
Cursor; or force one with `AI_PROVIDER`. The model only ever receives a compact
snapshot of the board through the local `/api/chat` endpoint; the key stays
server-side. With no key, the app runs fully offline and the bar reports disabled.

| Variable            | Purpose                                        | Default                |
|---------------------|------------------------------------------------|------------------------|
| `OPENAI_API_KEY`    | Use OpenAI (Chat Completions)                  | *(unset)*              |
| `ANTHROPIC_API_KEY` | Use Anthropic / Claude (Messages API)          | *(unset)*              |
| `CURSOR_API_KEY`    | Use the Cursor SDK gateway                     | *(unset)*              |
| `AI_PROVIDER`       | Force `openai` \| `anthropic` \| `cursor`      | auto-detect            |
| `AI_MODEL`          | Pin a model id                                 | per-provider default   |
| `BOARD_TITLE`       | Custom board title in the header               | `StoryDeck`            |
| `DB_PATH`           | Override the SQLite file location              | `data/todo.db`         |

## Development

```bash
npm test        # node --test — unit, API, and frontend tests
./tools/shots.sh  # capture screenshots (board / list / dashboard)
```

Tests run against the committed **sample seed**, so they are deterministic in a
clean clone and never depend on private data.

## License

MIT.
