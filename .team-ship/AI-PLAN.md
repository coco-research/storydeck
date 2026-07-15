# AI Assistant — Feature Plan (team/ship)

## Goal
A compact, retro-terminal **ask bar** at the top of the board. The user types a plain-language
request; a small chat window shows a short reply and the board actions the assistant took.
It is **agentic**: it mutates the board through tools, not just chat.

## Decisions (locked with user)
- **Provider:** Cursor SDK (`@cursor/sdk`) — matches this Node/ESM repo.
- **Model:** Sonnet 4.6 for everything. Exact slug resolved via `Cursor.models.list()`; configurable via `AI_MODEL`.
- **Privacy:** AI **on by default**. NOTE: story text egresses through Cursor's infra to the model — this relaxes the strict "nothing leaves this machine" property for anyone who uses the chat. Documented in `src/server.js` header.
- **Permissions:** `add` / `edit` / `complete` / `comment`. **No delete.** No reorder.

## Architecture (local-first preserved for the DB; chat is the one egress)
```
Browser ask-bar/chat  ──POST /api/chat (127.0.0.1 only)──▶  src/server.js
                                                               │
                                                               ▼
                                              src/ai/agent.js  runAssistant()
                                                 │  @cursor/sdk Agent.prompt as the model
                                                 │  gateway. Prompt = system + compact board
                                                 │  context + user msg. Model returns STRICT
                                                 │  JSON {reply, actions[]} (no file edits).
                                                 ▼
                                    src/ai/tools.js  boardTools(db) executes actions
                                                 │
                                                 ▼
                                              src/db.js ─▶ SQLite
```
- **Why JSON-plan, not MCP:** the Cursor SDK runs a *coding* agent; asking it to emit a strict
  action plan (instead of wiring MCP tools it might ignore in favor of editing files) is far more
  reliable, keeps it from touching the repo, and is trivially testable. The SDK is used purely as
  the Sonnet gateway.
- The browser never sees the API key. `CURSOR_API_KEY` is read server-side only.
- Live board context (counts + `#id [TAG] title · epic` lines + urgent) is injected into every
  prompt, so the model can answer questions and target ids without a separate read round-trip.
- Only `add_story` / `update_story` / `complete_story` / `add_comment` are executed. Unknown or
  delete/reorder actions are ignored.

## Files
- `src/ai/tools.js` — `boardTools(db)` → `{ add_story, update_story, complete_story, add_comment, search_stories, get_board_summary }` + `TOOL_SPECS`. Pure, unit-testable.
- `src/ai/agent.js` — `runAssistant({ message, dbPath, model })`; lazy-imports `@cursor/sdk` so the module loads without it. `resolveModel()` picks a Sonnet slug via `Cursor.models.list()`. `setModelRunner()` hook for tests (inject a fake gateway).
- `src/server.js` — `POST /api/chat` → `{ reply, actions, stories }`.
- `public/index.html` — retro ask bar + chat window; board auto-refresh from returned stories.

## Tool contract (given to the model)
| tool | args | effect |
|---|---|---|
| `add_story` | task, epic?, points?, urgent?, status?(todo/in-progress/blocked/done), note? | create |
| `update_story` | id, {task?, epic?, points?, urgent?, status?} | edit |
| `complete_story` | id | mark done |
| `add_comment` | id, text | append comment |
| `search_stories` | query | read (title/epic/note/comments) |
| `get_board_summary` | — | read counts by state + urgent list |

System prompt: "You are the board assistant. Use ONLY these tools to fulfill requests.
Reply in ONE short line. Never write code or files. If a request is ambiguous, make the
most reasonable assumption and state it briefly."

## UI (retro terminal)
- Toolbar gains a mode toggle on the top line: `search` ⇄ `ask`. In `ask` mode the prompt reads
  `rijul@board:~$ ask ▸ …`.
- A small chat window (max ~6 lines, monospace) drops under the bar: user line, `AI ▸` reply,
  and an `actions:` line (e.g. `+ #72 created · TODO · CR07 · !!`). Auto-scrolls; `Esc` closes.
- After a run, replace `tasks` with returned `stories` and `render()`.
- Keyboard: `/` focuses search (existing), `a` focuses ask.

## Guardrails
- Cap: single-turn `Agent.prompt` (one-shot); server timeout ~60s; message length cap.
- If `@cursor/sdk` missing or `CURSOR_API_KEY` unset → `/api/chat` returns 503 with a clear message; UI shows it inline.
- Agent runs against an empty `./.ai-scratch` cwd so it can't touch the repo.
- Only the six tools above are registered; no destructive ops.

## Tests (no real egress in CI)
1. `test/ai-tools.test.js` — each handler against a temp `:memory:` DB (create/edit/complete/comment/search/summary; no-delete surface).
2. `test/server.test.js` — `/api/chat` with an injected fake runner (asserts contract + board refresh; 503 when disabled).
3. `test/frontend.test.js` — ask-bar + chat window markup renders; mode toggle present.

## Ship loop
2-hour loop: build → `node --test` → `./tools/shots.sh` (adds a chat-open frame) → UI audit vs retro theme → append `.team-ship/EVIDENCE.md`.
