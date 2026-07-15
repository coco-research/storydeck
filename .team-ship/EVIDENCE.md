# EVIDENCE — Ship run: local SQLite board + search + compact + Anthropic UI

Every claim in the final report is backed by a captured command + output below.
Adapted ship pipeline (no git repo → no PR/CI stages); hard gates retained.

## Env parity (Stage 7)
- Node `v25.8.2`, npm `11.11.1` (captured).
- `node:sqlite` (`DatabaseSync`) works with NO flags, NO native build:
  `node:sqlite OK -> {"id":1,"name":"hello"}`
- No external services required. Zero npm dependencies (Node built-ins only).

## Test execution (Stage 8) — builder run
Command: `cd /Users/Rijul_Kalra/ToDo && node --test`
```
ℹ tests 32
ℹ pass 32
ℹ fail 0
ℹ skipped 0
ℹ todo 0
```
Backend: 21 tests (db repository + HTTP API + loopback guard).
Frontend: 11 tests (search, density/compact, custom dropdown, state mapping, render of all 71).
No skips → status PASS (not UNVERIFIED).

## Live integration (builder run)
Command: boot `PORT=4399 node src/server.js`, then curl:
```
static page served at / : Rijul's Stories ; cs-select occurrences: 12
seeded state: stories 71 done 16
create id=72 ; comments: 1 ; status: done completed: true ; delete HTTP 200
export version 1 stories 71
```

## Independent verification (Stage 11) — separate agents, did NOT read builder claims
Agent A (static, read-only): PASS on — no external deps/no cloud; binds 127.0.0.1 with loopback guard; search+compact+custom-dropdown present; no native `<select>` in cards; seed = 71, idempotent. Could not run shell (read-only) → deferred test execution to Agent B.

Agent B (independent execution, clean state):
```
node --test  → tests 32 / pass 32 / fail 0 / skipped 0 / todo 0   → PASS
/api/state   → story_count=71, done_count=16                       → PASS
/            → cs-select ×12, "Rijul's Stories" matched            → PASS
POST create  → id=72                                               → PASS
PATCH done   → status=done, completed=2026-07-14                   → PASS
DELETE       → 200                                                  → PASS
/api/nope    → 404                                                  → PASS
cleanup      → ls data/ = seed.json only                           → PASS
```
Overall independent verdict: **CLEAN PASS**.

## Claim ↔ evidence (Stage 12)
- "71 stories, 16 done" ← /api/state (builder + independent).
- "local-only, no cloud" ← package.json has no deps; src imports only node:*; server binds 127.0.0.1 + isLoopback guard (independent static review).
- "search / compact / custom dropdown" ← frontend tests + independent static review + rendered HTML (cs-select ×12, no `<select>`).
- "tests pass" ← independent `node --test` = 32/32, 0 skipped.

## Notes / honest limitations
- Single-device by design; cross-device sync intentionally NOT built (compliance).
- `node:sqlite` is a "stable-enough" built-in but still marked experimental by Node; JSON export/import + startup backup retained as the durable copy so the DB is never the only record.
- Manual browser click-through of drag-and-drop was not automated (JSDOM lacks layout); drag/reorder logic is covered at the API level (`/api/stories/reorder`) and the DOM handlers are unchanged from the previously-working version.

---

## AI Assistant feature (agentic chat) — added

**Plan:** `.team-ship/AI-PLAN.md`. Provider = Cursor SDK (`@cursor/sdk`) as the Sonnet gateway;
JSON-plan approach (model returns `{reply, actions[]}`, server executes via `boardTools`).
Model = Sonnet (resolved via `Cursor.models.list()`, override `AI_MODEL`). AI on by default.
Permissions = add / edit / complete / comment — NO delete, NO reorder.

**Files:** `src/ai/tools.js` (pure handlers + TOOL_SPECS), `src/ai/agent.js` (runAssistant +
setModelRunner test hook + resolveModel + extractJSON), `src/server.js` (`POST /api/chat`),
`public/index.html` (retro ask bar `#ai-input` + chat window `#ai-chat`, `a` shortcut).

**Egress honesty:** server header comment updated — `/api/chat` is the single path story text
leaves the machine, and only when the user actively asks the assistant.

**Tests (independent `node --test`):** 50/50 pass, 0 fail.
- `test/ai-tools.test.js` — 12 cases: each tool over `:memory:` DB, no-delete surface, extractJSON,
  runAssistant executes/ignores actions via injected model (no network).
- `test/server.test.js` — `/api/chat` returns reply+actions+refreshed board (injected model),
  question path doesn't mutate, empty message → 400.
- `test/frontend.test.js` — ask bar + chat window markup, posts `/api/chat`, `initAI` wired, `a` focuses.

**Runtime smoke:**
```
GET  /api/state → 200 (71 stories)
POST /api/chat (no CURSOR_API_KEY) → 503 {"disabled":true} "CURSOR_API_KEY is not set"  (graceful)
```

**UI:** `screenshots/prod-ai.png` — ask bar + chat window match the retro terminal theme
(orange `rijul@board:~$ ask ▸`, blue `AI ▸`, green action lines). Added to `tools/shots.sh` loop set.

**Honest limitation:** real end-to-end AI run requires `CURSOR_API_KEY` in the server env and a
valid Sonnet model slug on the account; CI/tests never call the live model (injected runner).
