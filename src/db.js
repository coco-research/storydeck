// Data layer for the local Stories board.
// Uses Node's built-in node:sqlite (DatabaseSync) — no native build, no external deps.
// The DB file lives on local disk; nothing is ever sent off-device.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const BACKUP_DIR = join(ROOT, 'backups');
const DEFAULT_DB_PATH = join(DATA_DIR, 'todo.db');
const SEED_PATH = join(DATA_DIR, 'seed.json');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT    NOT NULL,
  epic        TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'pending',   -- 'pending' | 'done'
  work_status TEXT,                                 -- NULL | 'in-progress' | 'blocked'
  urgent      INTEGER NOT NULL DEFAULT 0,           -- 0 | 1
  points      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  position    INTEGER NOT NULL DEFAULT 0,           -- ordering within a column
  added       TEXT,
  completed   TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  created    TEXT,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);
CREATE INDEX IF NOT EXISTS idx_stories_position ON stories(position);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

function nowISO() {
  return new Date().toISOString();
}

export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:' && !existsSync(dirname(dbPath))) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// ── mapping between DB rows and the story shape the frontend expects ──────────
function rowToStory(db, row) {
  const comments = db
    .prepare('SELECT text, created FROM comments WHERE story_id = ? ORDER BY id ASC')
    .all(row.id)
    .map((c) => ({ text: c.text, created: c.created || '' }));

  const story = {
    id: row.id,
    task: row.task,
    project: row.epic || '',
    status: row.status === 'done' ? 'done' : 'pending',
    points: Number.isFinite(row.points) ? row.points : 1,
    position: row.position,
    added: row.added || undefined,
    comments,
  };
  if (row.status === 'done') story.completed = row.completed || undefined;
  else if (row.work_status) story.workStatus = row.work_status;
  if (row.urgent) story.urgent = true;
  if (row.note) story.note = row.note;
  return story;
}

export function listStories(db) {
  const rows = db.prepare('SELECT * FROM stories ORDER BY position ASC, id ASC').all();
  return rows.map((r) => rowToStory(db, r));
}

export function getStory(db, id) {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  return row ? rowToStory(db, row) : null;
}

function normalizePoints(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function nextPosition(db) {
  const row = db.prepare('SELECT MAX(position) AS maxPos FROM stories').get();
  return (row?.maxPos ?? -1) + 1;
}

export function createStory(db, input = {}) {
  const ts = nowISO();
  const task = String(input.task || '').trim();
  if (!task) throw new Error('task is required');

  const status = input.status === 'done' ? 'done' : 'pending';
  const workStatus =
    status === 'done' ? null : normalizeWorkStatus(input.workStatus);
  const completed = status === 'done' ? input.completed || ts.slice(0, 10) : null;
  const position = Number.isFinite(input.position) ? input.position : nextPosition(db);

  const info = db
    .prepare(
      `INSERT INTO stories (task, epic, status, work_status, urgent, points, note, position, added, completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task,
      normalizeEpic(input.project),
      status,
      workStatus,
      input.urgent ? 1 : 0,
      normalizePoints(input.points),
      input.note ? String(input.note) : null,
      position,
      input.added || ts.slice(0, 10),
      completed,
      ts,
      ts
    );

  const id = Number(info.lastInsertRowid);
  if (Array.isArray(input.comments)) {
    for (const c of input.comments) {
      const text = String(c?.text || '').trim();
      if (text) insertComment(db, id, text, c?.created || '');
    }
  }
  return getStory(db, id);
}

const MUTABLE_FIELDS = new Set([
  'task', 'project', 'status', 'workStatus', 'urgent', 'points', 'note', 'completed', 'added',
]);

export function updateStory(db, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  if (!existing) return null;

  const next = {
    task: existing.task,
    epic: existing.epic,
    status: existing.status,
    work_status: existing.work_status,
    urgent: existing.urgent,
    points: existing.points,
    note: existing.note,
    completed: existing.completed,
    added: existing.added,
  };

  for (const key of Object.keys(patch)) {
    if (!MUTABLE_FIELDS.has(key)) continue;
    switch (key) {
      case 'task': {
        const t = String(patch.task || '').trim();
        if (t) next.task = t;
        break;
      }
      case 'project':
        next.epic = normalizeEpic(patch.project);
        break;
      case 'status':
        next.status = patch.status === 'done' ? 'done' : 'pending';
        break;
      case 'workStatus':
        next.work_status = normalizeWorkStatus(patch.workStatus);
        break;
      case 'urgent':
        next.urgent = patch.urgent ? 1 : 0;
        break;
      case 'points':
        next.points = normalizePoints(patch.points, existing.points);
        break;
      case 'note':
        next.note = patch.note ? String(patch.note) : null;
        break;
      case 'completed':
        next.completed = patch.completed || null;
        break;
      case 'added':
        next.added = patch.added || null;
        break;
    }
  }

  // Keep status / work_status / completed internally consistent.
  if (next.status === 'done') {
    next.work_status = null;
    if (!next.completed) next.completed = nowISO().slice(0, 10);
  } else {
    next.completed = null;
  }

  db.prepare(
    `UPDATE stories SET task=?, epic=?, status=?, work_status=?, urgent=?, points=?, note=?, completed=?, added=?, updated_at=? WHERE id=?`
  ).run(
    next.task,
    next.epic,
    next.status,
    next.work_status,
    next.urgent,
    next.points,
    next.note,
    next.completed,
    next.added,
    nowISO(),
    id
  );
  return getStory(db, id);
}

export function deleteStory(db, id) {
  const info = db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  return info.changes > 0;
}

// Reassign positions for the given ordered ids so they sort correctly within a column.
export function reorderStories(db, orderedIds = []) {
  const ids = [...new Set(orderedIds.map((n) => Number.parseInt(n, 10)).filter(Number.isFinite))];
  const base = nextPosition(db);
  const stmt = db.prepare('UPDATE stories SET position = ?, updated_at = ? WHERE id = ?');
  const ts = nowISO();
  const run = db.prepare('BEGIN');
  run.run();
  try {
    ids.forEach((id, index) => stmt.run(base + index, ts, id));
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  return true;
}

function insertComment(db, storyId, text, created) {
  return db
    .prepare('INSERT INTO comments (story_id, text, created, created_at) VALUES (?, ?, ?, ?)')
    .run(storyId, text, created || '', nowISO());
}

export function addComment(db, storyId, text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('comment text is required');
  const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(storyId);
  if (!story) return null;
  const created = nowISO().slice(0, 16).replace('T', ' ');
  insertComment(db, storyId, clean, created);
  return getStory(db, storyId);
}

// ── helpers ───────────────────────────────────────────────────────────────
function normalizeEpic(value) {
  const v = (value || '').trim();
  return v === 'Unassigned' ? '' : v;
}

function normalizeWorkStatus(value) {
  return value === 'in-progress' || value === 'blocked' ? value : null;
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

// One-time seed from data/seed.json. Idempotent: guarded by a meta flag.
export function seedIfEmpty(db, seedPath = SEED_PATH) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM stories').get().n;
  if (count > 0 || getMeta(db, 'seeded') === 'true') return { seeded: false, count };
  if (!existsSync(seedPath)) return { seeded: false, count: 0 };

  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const run = db.prepare('BEGIN');
  run.run();
  try {
    seed.forEach((s, i) => {
      createStory(db, {
        ...s,
        position: Number.isFinite(s.position) ? s.position : i,
      });
    });
    setMeta(db, 'seeded', 'true');
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  return { seeded: true, count: seed.length };
}

// Replace all data transactionally (used by JSON import). Keeps a backup first.
export function replaceAll(db, stories = []) {
  if (!Array.isArray(stories)) throw new Error('stories must be an array');
  const run = db.prepare('BEGIN');
  run.run();
  try {
    db.prepare('DELETE FROM comments').run();
    db.prepare('DELETE FROM stories').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('stories','comments')").run();
    stories.forEach((s, i) => {
      createStory(db, { ...s, position: Number.isFinite(s.position) ? s.position : i });
    });
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  return listStories(db);
}

// Snapshot the current data to a timestamped JSON backup on local disk.
export function backup(db, dir = BACKUP_DIR) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `stories-${stamp}.json`);
  const payload = {
    version: 1,
    exportedAt: nowISO(),
    stories: listStories(db),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

export { DEFAULT_DB_PATH, BACKUP_DIR };
