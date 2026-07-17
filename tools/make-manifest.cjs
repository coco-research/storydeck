#!/usr/bin/env node
// Generate content-manifest.json — the list of hot-updatable files (web/ + src/)
// with a SHA-256 for each and a monotonic contentVersion. Published to GitHub so
// installed apps can verify + pull newer content on launch (see src/updater.js).
//
// contentVersion defaults to epoch seconds (monotonic across builds/pushes);
// override with CONTENT_VERSION for reproducible tests.

const { createHash } = require('node:crypto');
const { readdirSync, statSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

const ROOT = join(__dirname, '..');
const DIRS = ['web', 'src'];

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = {};
for (const d of DIRS) {
  for (const f of walk(join(ROOT, d), []).sort()) {
    const rel = relative(ROOT, f).split(sep).join('/');
    files[rel] = createHash('sha256').update(readFileSync(f)).digest('hex');
  }
}

// Avoid churn: only bump the version + rewrite when the file set/hashes actually
// changed, so a no-op push doesn't make every installed app "update" to identical
// content (or create a spurious commit from a changing timestamp).
const OUT = join(ROOT, 'content-manifest.json');
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const sameContent = prev && JSON.stringify(prev.files) === JSON.stringify(files);
if (sameContent) {
  console.log(`content-manifest.json unchanged (v${prev.contentVersion}, ${Object.keys(files).length} files)`);
  process.exit(0);
}

const contentVersion = Number(process.env.CONTENT_VERSION)
  || Math.max(Math.floor(Date.now() / 1000), Number(prev?.contentVersion || 0) + 1);
const manifest = {
  contentVersion,
  generatedAt: new Date().toISOString(),
  repo: 'coco-research/storydeck-content',
  files,
};
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote content-manifest.json v${contentVersion} (${Object.keys(files).length} files)`);
