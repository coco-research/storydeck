#!/usr/bin/env node
// Generate content-manifest.json — the list of hot-updatable files (web/ + src/)
// with a SHA-256 for each and a monotonic contentVersion. Published to GitHub so
// installed apps can verify + pull newer content on launch (see src/updater.js).
//
// contentVersion defaults to epoch seconds (monotonic across builds/pushes);
// override with CONTENT_VERSION for reproducible tests.

const { createHash } = require('node:crypto');
const { readdirSync, statSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { execSync } = require('node:child_process');
const { join, relative, sep } = require('node:path');

function gitShortSha() {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); }
  catch { return null; }
}

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

const OUT = join(ROOT, 'content-manifest.json');
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const appVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
const commit = gitShortSha();

// contentVersion (the integer that drives re-downloads) bumps ONLY when the
// actual downloadable files change — so a no-op push never makes installed apps
// "update" to identical content. Metadata (appVersion/commit) can still change
// without a bump: we rewrite the manifest but keep the same contentVersion.
const filesSame = prev && JSON.stringify(prev.files) === JSON.stringify(files);
const metaSame = prev && prev.appVersion === appVersion && prev.commit === commit;
if (filesSame && metaSame) {
  console.log(`content-manifest.json unchanged (app v${appVersion}, content v${prev.contentVersion}, ${Object.keys(files).length} files)`);
  process.exit(0);
}

const contentVersion = Number(process.env.CONTENT_VERSION)
  || (filesSame ? prev.contentVersion : Math.max(Math.floor(Date.now() / 1000), Number(prev?.contentVersion || 0) + 1));

const manifest = {
  appVersion,                       // semver of the app/content release (human-readable)
  contentVersion,                   // monotonic integer used for update comparison
  channel: process.env.STORYDECK_CHANNEL || 'stable',
  commit,                           // source revision this content was built from
  generatedAt: new Date().toISOString(),
  repo: 'coco-research/storydeck-content',
  files,
};
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote content-manifest.json: app v${appVersion}, content v${contentVersion}${commit ? ` (${commit})` : ''}, ${Object.keys(files).length} files${filesSame ? ' [metadata only, content unchanged]' : ''}`);
