import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const mainJs = readFileSync(join(repoRoot, 'main.js'), 'utf8');

test('package.json build identity', () => {
  assert.equal(packageJson.build.appId, 'com.storydeck.app');
  assert.equal(packageJson.build.productName, 'StoryDeck');
});

test('package.json mac target includes dmg', () => {
  assert.ok(
    packageJson.build.mac.target.includes('dmg'),
    'build.mac.target must include dmg for macOS desktop release',
  );
});

test('package.json build.files includes required assets', () => {
  const required = [
    'main.js',
    'src/**/*',
    'web/**/*',
    'data/seed.sample.json',
    'package.json',
  ];
  for (const entry of required) {
    assert.ok(
      packageJson.build.files.includes(entry),
      `build.files must include ${entry}`,
    );
  }
});

test('package.json build output directory is dist', () => {
  assert.equal(packageJson.build.directories.output, 'dist');
});

test('main.js wires packaged data path via userData', () => {
  assert.match(mainJs, /app\.isPackaged/);
  assert.match(mainJs, /process\.env\.DB_PATH/);
  assert.match(mainJs, /app\.getPath\('userData'\)/);
});

test('main.js exposes BOARD_SELFTEST self-test hook', () => {
  assert.match(mainJs, /BOARD_SELFTEST/);
});
