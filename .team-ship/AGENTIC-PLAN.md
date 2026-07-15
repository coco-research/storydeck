# Agentic Assistant + Memory — Build Plan (60-min ship loop)

## Goal
Make the ask bar genuinely **agentic** (it takes actions + drives the board, not just
chats), give the chat a **clear** control so it isn't an endless screen, and lay down a
**memory** architecture so the assistant remembers context about the user's work.

## Public-version discipline (READ EVERY TICK) — see `.team-ship/PUBLIC-VERSION.md`
This repo is the **public** StoryDeck product; this laptop is the **private first-user**
instance. Same code, different data. Every tick MUST keep the repo public-safe:
- Never commit real data (`data/seed.json`, `data/*.db`, `backups/`) or secrets (`.env`).
- Build features generically; example data goes in `data/seed.sample.json` (fictional).
- Tests seed from the sample so a clean clone is green with zero private data.
- Branding is generic ("StoryDeck"), configurable via `BOARD_TITLE`; no real names/vendors.
- Push to `coco-research/storydeck` only when explicitly asked, after verifying
  `git ls-files | grep -E 'seed\.json|\.db|backups/|\.env$'` is empty.

## Delivery vehicle — Electron (not Tauri)
This app is an **Electron** desktop app: `main.js` boots the local `node:sqlite` server
inside Electron's Node runtime and loads `http://127.0.0.1:4321` in a native window.
- Desktop window: `npm run app`  (electron .)
- Browser/headless: `npm start`   (node src/server.js) → open the URL in a browser
There is **no Tauri** config. "I don't see an app" = you're running `npm start` (browser
mode). Note: you can't run both at once — both bind port 4321.

## Current state (this tick)
### Agentic actions — DONE
- Read tools now execute: `search_stories`, `get_board_summary`.
- New client action `focus_board {epic|status|query}` — the model filters what you SEE
  (e.g. "the urgent ones" → focus_board {epic:"Urgent"} and lists them).
- System prompt rewritten to force enumeration ("#id title") and tool use.
- Fixed the `· #undefined` line (action rendering now falls back safely).
- Chat renders read results (summary counts, urgent queue, search matches).

### Clear the transcript — DONE
- `clear` button in the chat header → wipes the log AND short-term memory.
- `✕` still just hides the window.

### Short-term memory — DONE (M0)
- Frontend keeps `aiHistory` (last ~20 turns), sends the last 8 with each `/api/chat`.
- Server injects a `RECENT CONVERSATION` block into the prompt so back-references resolve
  ("take me there", "that one", "the second"). Cleared by the `clear` button.

## Memory architecture — inspired by Coco Connect M0
Three layers, built incrementally:

1. **Working memory (turn context)** — the running chat transcript. *(shipped, M0)*
   - Ephemeral, per-session, sent with each request. Zero storage.

2. **Board state as memory** — the board itself is the source of truth; the compact
   snapshot is injected every turn. *(shipped)* The assistant "remembers" your work
   because it re-reads the board each turn.

3. **Long-term memory (durable facts)** — *proposed, next ticks*. A `memory` table in the
   same on-device SQLite DB:
   ```
   memory(id, kind, text, entity, weight, created, last_used)
     kind ∈ { fact, preference, entity, pin }
   ```
   - The assistant can `remember {text, kind, entity}` and `recall {query}` as tools.
   - Examples: "OneTrust renewal is top priority", "Kevin = my director", "budget doc is
     this week's #1", preferred epic naming, recurring people/vendors.
   - Retrieval: cheap keyword/BM25 match over `memory.text` + top-weighted pins, injected
     into the prompt as a `KNOWN FACTS` block (cap ~15 lines).
   - Decay/pruning: bump `weight`/`last_used` on recall; prune stale low-weight rows.
   - **Local-first**: memory never leaves the machine except via the same single `/api/chat`
     egress already used for the board snapshot. No new external surface.

   Coco Connect M0 parallels: a lightweight "connect" layer that ties conversation →
   durable facts → retrieval, versioned as M0 (baseline: capture + recall, no ranking ML),
   then M1 (weighting/decay), M2 (embeddings + semantic recall) if it proves useful.

## Roadmap for the loop ticks (~10-min cadence, 60 min)
- [x] Agentic reads + focus_board + prompt + `#undefined` fix
- [x] Clear button + short-term memory + tests (54 green)
- [ ] Long-term `memory` table + `remember`/`recall` tools + prompt `KNOWN FACTS` block
- [ ] "pin" a story/epic to memory; assistant proactively surfaces pins in summaries
- [ ] Harden: ambiguous-id disambiguation, multi-action turns, long replies
- [ ] Optional: instant client-side intents (urgent/counts/filter) to skip the ~10s model round-trip
- [ ] UI audit of the chat vs retro theme; screenshots; keep `node --test` green
- [ ] Ship notes + update AI-PLAN.md

## Test / verify each tick
- `node --test` stays green (unit + API + frontend).
- Live probe `/api/chat` for: "the urgent ones", "show <epic>", "take me there",
  "how many WIP", "add … urgent CR07", "mark #N done".
- `./tools/shots.sh` for visual parity.
