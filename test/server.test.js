import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, isLoopback } from '../src/server.js';
import { setModelRunner } from '../src/ai/agent.js';
import { SAMPLE_SEED_PATH } from '../src/db.js';

let server;
let base;

before(async () => {
  // Seed from the committed public sample so the suite is deterministic in any clone.
  const app = createApp(':memory:', SAMPLE_SEED_PATH);
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

test('isLoopback accepts loopback, rejects public addresses', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('192.168.1.50'), false);
  assert.equal(isLoopback('10.0.0.1'), false);
  assert.equal(isLoopback('8.8.8.8'), false);
});

test('GET /api/state returns the seeded board', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.stories.length, 14);
});

test('GET /api/state exposes configurable branding fields', async () => {
  // Contract check (env-agnostic): title/user are non-empty strings and
  // coreEpics is a non-empty array. Values come from BOARD_* env with generic
  // public defaults; a private overlay may override them.
  const res = await fetch(`${base}/api/state`);
  const data = await res.json();
  assert.equal(typeof data.title, 'string');
  assert.ok(data.title.length > 0);
  assert.equal(typeof data.user, 'string');
  assert.ok(data.user.length > 0);
  assert.ok(Array.isArray(data.coreEpics) && data.coreEpics.length > 0);
});

test('POST /api/stories creates a story', async () => {
  const res = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'API created', project: 'Tech', points: 2 }),
  });
  assert.equal(res.status, 201);
  const { story } = await res.json();
  assert.ok(story.id > 0);
  assert.equal(story.task, 'API created');
  assert.equal(story.project, 'Tech');
});

test('POST /api/stories with empty task returns 400', async () => {
  const res = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: '' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/stories/:id updates a story', async () => {
  const create = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'patch me' }),
  });
  const { story } = await create.json();
  const res = await fetch(`${base}/api/stories/${story.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()).story;
  assert.equal(updated.status, 'done');
  assert.ok(updated.completed);
});

test('DELETE /api/stories/:id removes a story', async () => {
  const create = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'delete me' }),
  });
  const { story } = await create.json();
  const res = await fetch(`${base}/api/stories/${story.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/stories/${story.id}`);
  assert.equal(check.status, 404);
});

test('POST /api/comments adds a comment', async () => {
  const create = await fetch(`${base}/api/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'needs comment' }),
  });
  const { story } = await create.json();
  const res = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyId: story.id, text: 'hello world' }),
  });
  assert.equal(res.status, 201);
  const updated = (await res.json()).story;
  assert.equal(updated.comments.length, 1);
  assert.equal(updated.comments[0].text, 'hello world');
});

test('POST /api/stories/reorder changes order', async () => {
  const mk = async (task) => {
    const r = await fetch(`${base}/api/stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, workStatus: 'blocked' }),
    });
    return (await r.json()).story;
  };
  const a = await mk('ReorderA');
  const b = await mk('ReorderB');
  const res = await fetch(`${base}/api/stories/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds: [b.id, a.id] }),
  });
  assert.equal(res.status, 200);
  const stories = (await res.json()).stories;
  const order = stories.filter((s) => ['ReorderA', 'ReorderB'].includes(s.task)).map((s) => s.task);
  assert.deepEqual(order, ['ReorderB', 'ReorderA']);
});

test('import replaces all data', async () => {
  const res = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stories: [{ task: 'imported solo', project: 'X' }] }),
  });
  assert.equal(res.status, 200);
  const stories = (await res.json()).stories;
  assert.equal(stories.length, 1);
  assert.equal(stories[0].task, 'imported solo');
});

test('import rejects a non-array payload with a clear 400', async () => {
  const res = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nope: true }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /stories array/i);
});

test('import rejects a malformed story and leaves the board unchanged', async () => {
  const before = (await (await fetch(`${base}/api/state`)).json()).stories;
  const res = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // entry #2 has no task — the whole import must be rejected.
    body: JSON.stringify({ stories: [{ task: 'ok' }, { project: 'X' }] }),
  });
  assert.equal(res.status, 400);
  const err = (await res.json()).error;
  assert.match(err, /entry #2/);
  assert.match(err, /not changed/i);
  const after = (await (await fetch(`${base}/api/state`)).json()).stories;
  assert.equal(after.length, before.length); // rollback / no-op: board intact
});

test('POST /api/reset clears the board to empty (backup happens server-side)', async () => {
  const res = await fetch(`${base}/api/reset`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.stories, []);
  // And the persisted state is now empty too.
  const after = (await (await fetch(`${base}/api/state`)).json()).stories;
  assert.equal(after.length, 0);
});

test('unknown API endpoint returns 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
});

test('POST /api/chat runs the assistant and returns reply + refreshed board', async () => {
  setModelRunner(async () => JSON.stringify({
    reply: 'created your story',
    actions: [{ tool: 'add_story', args: { task: 'AI-added story', epic: 'CR07' } }],
  }));
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'add a CR07 story' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.reply, 'created your story');
    assert.ok(data.actions[0].ok);
    assert.ok(Array.isArray(data.stories));
    assert.ok(data.stories.some((s) => s.task === 'AI-added story'));
  } finally {
    setModelRunner(null);
  }
});

test('POST /api/chat answers a question without mutating the board', async () => {
  setModelRunner(async () => JSON.stringify({ reply: 'you have work in progress', actions: [] }));
  try {
    const before = (await (await fetch(`${base}/api/state`)).json()).stories.length;
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'how many WIP?' }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.actions.length, 0);
    assert.equal(data.stories.length, before);
  } finally {
    setModelRunner(null);
  }
});

test('POST /api/chat with empty message returns 400', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '   ' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/chat runs read tools (get_board_summary) and returns results', async () => {
  setModelRunner(async () => JSON.stringify({
    reply: 'summary below',
    actions: [{ tool: 'get_board_summary', args: {} }],
  }));
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'how many WIP?' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const summary = data.actions.find(a => a.tool === 'get_board_summary');
    assert.ok(summary && summary.ok, 'summary action executed');
    assert.equal(typeof summary.total, 'number');
    assert.ok(Array.isArray(summary.urgent), 'returns the urgent queue');
  } finally {
    setModelRunner(null);
  }
});

test('POST /api/chat forwards conversation history to the model (memory)', async () => {
  let seenPrompt = '';
  setModelRunner(async (prompt) => {
    seenPrompt = prompt;
    return JSON.stringify({ reply: 'showing the urgent ones', actions: [{ tool: 'focus_board', args: { epic: 'Urgent' } }] });
  });
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'take me there',
        history: [
          { role: 'user', text: 'where are the urgent ones' },
          { role: 'assistant', text: 'Urgent queue (8): #4 ...' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    assert.match(seenPrompt, /RECENT CONVERSATION/);
    assert.match(seenPrompt, /where are the urgent ones/);
  } finally {
    setModelRunner(null);
  }
});

test('POST /api/chat echoes a focus_board action for the client to apply', async () => {
  setModelRunner(async () => JSON.stringify({
    reply: 'showing the urgent ones',
    actions: [{ tool: 'focus_board', args: { epic: 'Urgent', status: 'ALL', query: 'finance' } }],
  }));
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'show urgent finance stories' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const focus = data.actions.find(a => a.tool === 'focus_board');
    assert.ok(focus && focus.ok, 'focus action returned ok');
    assert.equal(focus.focus.epic, 'Urgent');
    assert.equal(focus.focus.status, 'all', 'status is normalized to lowercase');
    assert.equal(focus.focus.query, 'finance');
  } finally {
    setModelRunner(null);
  }
});
