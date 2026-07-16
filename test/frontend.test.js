import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Build a sandbox that runs the frontend <script> against a mocked DOM,
// then exposes internal functions for assertions.
function buildApp() {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

  const nodes = {};
  const store = new Map();
  function classList() {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)) };
  }
  function makeNode() {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, hidden: false,
      style: {}, dataset: {}, className: '', children: [],
      classList: classList(),
      setAttribute() {}, getAttribute() { return null; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { this.children.push(c); }, focus() {}, select() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      scrollIntoView() {}, contains() { return false; }, closest() { return null; },
    };
  }

  const documentMock = {
    activeElement: null,
    getElementById(id) { if (!nodes[id]) nodes[id] = makeNode(); return nodes[id]; },
    createElement() { return makeNode(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const sandbox = {
    document: documentMock,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    window: { prompt: () => null, confirm: () => true, alert() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ stories: [] }) }),
    Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    setTimeout: (fn) => fn && 0, clearTimeout() {}, FileReader: class {}, console,
  };

  const expose = `; return {
    matchesSearch, statePatch, getProjects, getEpics, epicSelectOptions, csSelectHTML,
    getSprintState, normalizeEpic, formatPoints, render, renderCard,
    setTasks: (x) => { tasks = x; }, setSearch: (q) => { searchQuery = q; },
    setActiveFilter: (f) => { activeFilter = f; }, setDensity, getDensity: () => density,
    setStatusFilter: (s) => { statusFilter = s; },
    taskListHTML: () => document.getElementById('task-list').innerHTML,
    metaText: () => document.getElementById('meta-line').textContent,
  };`;

  const factory = new Function(
    'document', 'localStorage', 'window', 'fetch', 'Blob', 'URL', 'setTimeout', 'clearTimeout', 'FileReader', 'console',
    script + expose
  );
  return factory(
    sandbox.document, sandbox.localStorage, sandbox.window, sandbox.fetch, sandbox.Blob,
    sandbox.URL, sandbox.setTimeout, sandbox.clearTimeout, sandbox.FileReader, sandbox.console
  );
}

// Always use the committed PUBLIC sample seed so the suite is deterministic and
// public-safe (never depends on the private overlay's real data).
const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'seed.sample.json'), 'utf8'))
  .map((s) => ({ ...s, comments: Array.isArray(s.comments) ? s.comments : [] }));

test('modals expose accessible dialog semantics', () => {
  // Static assertion on the shipped markup: both dialogs must be labelled and
  // marked as modal so screen readers announce them and focus tooling can trap.
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const dialogs = html.match(/<div class="modal"[^>]*>/g) || [];
  assert.equal(dialogs.length, 2, 'expected two .modal dialogs');
  for (const tag of dialogs) {
    assert.match(tag, /role="dialog"/);
    assert.match(tag, /aria-modal="true"/);
    assert.match(tag, /aria-labelledby="/);
  }
});

test('ask bar has an AI provider status chip wired to the key modal', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert.match(html, /id="ai-status"[^>]*onclick="openAiKeyModal\(\)"/);
  assert.match(html, /function refreshAiStatusBadge\(/);
});

test('statePatch maps sprint states to API patches', () => {
  const app = buildApp();
  assert.deepEqual(app.statePatch('done'), { status: 'done' });
  assert.deepEqual(app.statePatch('todo'), { status: 'pending', workStatus: null });
  assert.deepEqual(app.statePatch('in-progress'), { status: 'pending', workStatus: 'in-progress' });
  assert.deepEqual(app.statePatch('blocked'), { status: 'pending', workStatus: 'blocked' });
});

test('getSprintState derives the correct column', () => {
  const app = buildApp();
  assert.equal(app.getSprintState({ status: 'done' }), 'done');
  assert.equal(app.getSprintState({ status: 'pending', workStatus: 'blocked' }), 'blocked');
  assert.equal(app.getSprintState({ status: 'pending', workStatus: 'in-progress' }), 'in-progress');
  assert.equal(app.getSprintState({ status: 'pending' }), 'todo');
});

test('normalizeEpic treats blank as Unassigned', () => {
  const app = buildApp();
  assert.equal(app.normalizeEpic(''), 'Unassigned');
  assert.equal(app.normalizeEpic('  '), 'Unassigned');
  assert.equal(app.normalizeEpic('Tech'), 'Tech');
});

test('getProjects/getEpics include core + custom epics from tasks', () => {
  const app = buildApp();
  app.setTasks(seed);
  const projects = app.getProjects();
  assert.ok(projects.includes('All'));
  assert.ok(projects.includes('Urgent'));
  ['Website', 'Mobile', 'GitHub', 'Personal'].forEach((e) => assert.ok(projects.includes(e), `missing ${e}`));
  const epics = app.getEpics();
  assert.ok(!epics.includes('All') && !epics.includes('Urgent'));
});

test('epicSelectOptions always includes selected + custom sentinel', () => {
  const app = buildApp();
  app.setTasks(seed);
  const opts = app.epicSelectOptions('ZZ-Unusual-Epic');
  assert.ok(opts.some((o) => o.value === 'ZZ-Unusual-Epic'));
  assert.ok(opts.some((o) => o.value === '__custom__' && o.custom));
});

test('csSelectHTML renders trigger, panel, and marks selected option', () => {
  const app = buildApp();
  const out = app.csSelectHTML({ id: 'x', value: 'Tech', options: [{ value: 'Tech', label: 'Tech' }, { value: 'AMS', label: 'AMS' }] });
  assert.match(out, /class="cs-trigger"/);
  assert.match(out, /role="listbox"/);
  assert.match(out, /data-value="Tech"[^>]*aria-selected="true"/);
  assert.match(out, /data-value="AMS"[^>]*aria-selected="false"/);
});

test('matchesSearch searches title, epic, note, and comments', () => {
  const app = buildApp();
  const story = { task: 'Review repo: nanoGPT', project: 'GitHub', note: 'karpathy', comments: [{ text: 'ping Ashley' }] };
  app.setSearch('nanogpt'); assert.equal(app.matchesSearch(story), true);
  app.setSearch('github'); assert.equal(app.matchesSearch(story), true);
  app.setSearch('karpathy'); assert.equal(app.matchesSearch(story), true);
  app.setSearch('ashley'); assert.equal(app.matchesSearch(story), true);
  app.setSearch('nonexistentxyz'); assert.equal(app.matchesSearch(story), false);
  app.setSearch(''); assert.equal(app.matchesSearch(story), true);
});

test('render draws all four columns and every seeded story', () => {
  const app = buildApp();
  app.setSearch('');
  app.setActiveFilter('All');
  app.setTasks(seed);
  app.render();
  const html = app.taskListHTML();
  ['To Do', 'In Progress', 'Blocked', 'Done'].forEach((c) => assert.ok(html.includes(c), `missing column ${c}`));
  // Every sample story renders as a card.
  const cardCount = (html.match(/class="task-card/g) || []).length;
  assert.equal(cardCount, 14);
  ['Ship push notifications', 'Set up the CI workflow', 'Vendor invoice'].forEach((t) =>
    assert.ok(html.includes(t), `missing task ${t}`)
  );
  assert.match(app.metaText(), /open stories/);
});

test('search narrows the rendered board', () => {
  const app = buildApp();
  app.setActiveFilter('All');
  app.setTasks(seed);
  app.setSearch('push notifications');
  app.render();
  const html = app.taskListHTML();
  assert.ok(html.includes('Ship push notifications'));
  assert.ok(!html.includes('Design new landing page hero'));
  const cardCount = (html.match(/class="task-card/g) || []).length;
  assert.equal(cardCount, 1);
});

test('compact density renders the flat list view (not the board)', () => {
  const app = buildApp();
  app.setTasks(seed);
  app.setDensity('compact');
  app.render();
  const html = app.taskListHTML();
  // Compact is now the preview's flat table: a single story-list, no kanban board.
  assert.ok(html.includes('story-list'), 'renders the flat list container');
  assert.ok(html.includes('list-row'), 'renders list rows');
  assert.ok(!html.includes('sprint-board'), 'does not render the board in compact');
  assert.equal(app.getDensity(), 'compact');
  app.setDensity('comfortable');
  app.render();
  assert.ok(app.taskListHTML().includes('sprint-board'), 'comfortable renders the board');
  assert.ok(!app.taskListHTML().includes('story-list'));
});

test('list view has the preview columns: id/status/story/epic/pts', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const css = html.match(/<style>([\s\S]*)<\/style>/)[1];
  // The flat list view styling must exist (grid rows + a header).
  assert.match(css, /\.list-head,\s*\.list-row\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.lr-epic\s*\{/);
  assert.match(css, /\.lr-pts\s*\{/);
});

test('status prefilter isolates one column in the board view', () => {
  const app = buildApp();
  app.setTasks(seed);
  app.setStatusFilter('in-progress');
  app.render();
  const html = app.taskListHTML();
  // Only the In Progress column should render; other columns are hidden.
  assert.ok(html.includes('single'), 'board collapses to a single column');
  assert.ok(html.includes('column-title in-progress'), 'shows the In Progress column');
  assert.ok(!html.includes('column-title todo') && !html.includes('column-title blocked') && !html.includes('column-title done'), 'hides other columns');
  // Every rendered card must be a WIP story.
  const wipTag = (html.match(/tag-in-progress/g) || []).length;
  const cards = (html.match(/class="task-card/g) || []).length;
  assert.ok(cards > 0 && wipTag >= cards, 'all cards are in-progress');
});

test('status prefilter narrows the compact list too', () => {
  const app = buildApp();
  app.setTasks(seed);
  app.setDensity('compact');
  app.setStatusFilter('done');
  app.render();
  const html = app.taskListHTML();
  const doneTags = (html.match(/tag-done/g) || []).length;
  const rows = (html.match(/class="list-row/g) || []).length;
  assert.ok(rows > 0, 'renders done rows');
  assert.equal(doneTags, rows, 'every list row is a done story');
  assert.ok(!html.includes('tag-todo') && !html.includes('tag-in-progress'));
  app.setStatusFilter('all');
  app.setDensity('comfortable');
});

test('AI ask bar + chat window are present and wired', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  // Markup: ask bar input + send + chat log.
  assert.match(html, /id="ai-input"/);
  assert.match(html, /id="ai-send"[^>]*onclick="aiSend\(\)"/);
  assert.match(html, /id="ai-chat"/);
  assert.match(html, /id="ai-log"/);
  // Behaviour: posts to /api/chat, refreshes tasks, and initAI is wired at startup.
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /'\/api\/chat'/);
  assert.match(script, /function aiSend\(/);
  assert.match(script, /initAI\(\)/);
  // 'a' focuses the ask bar.
  assert.match(script, /getElementById\('ai-input'\)\?\.focus\(\)/);
});

test('AI chat is agentic: clear button, memory, focus, and no #undefined', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  // Clear button so the transcript is not an endless screen.
  assert.match(html, /id="ai-chat-clear"[^>]*onclick="aiClearChat\(\)"/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /function aiClearChat\(/);
  // Short-term memory: history state sent to the server and recorded per turn.
  assert.match(script, /let aiHistory =/);
  assert.match(script, /history: aiHistory\.slice/);
  assert.match(script, /aiHistory\.push\(\{ role: 'user'/);
  // Agentic rendering: focus_board applies a view, read tools render results.
  assert.match(script, /function applyAIFocus\(/);
  assert.match(script, /a\.tool === 'focus_board'/);
  assert.match(script, /a\.tool === 'get_board_summary'/);
  assert.match(script, /a\.tool === 'search_stories'/);
  // Never emit a literal "#undefined" action line.
  assert.match(script, /a\.id != null \? `#\$\{a\.id\}`/);
});

test('cards use the custom dropdown, not a native select', () => {
  const app = buildApp();
  app.setTasks(seed);
  app.render();
  const html = app.taskListHTML();
  assert.ok(html.includes('cs-select'), 'custom dropdown present');
  assert.ok(!/<select/.test(html), 'no native <select> in cards');
});
