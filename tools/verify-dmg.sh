#!/usr/bin/env bash
# Runtime verification harness for StoryDeck's packaged/desktop data flow.
#
# Proves that the on-device SQLite database is created on first open, seeded
# from the sample when empty, and persists stories across separate opens —
# the same path the Electron app uses via DB_PATH / userData.

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-node}"
FAILURES=0

fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

pass() {
  echo "PASS: $*"
}

run_node_mode() {
  local tmp db_path story_count out1 out2

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  db_path="$tmp/todo.db"
  export DB_PATH="$db_path"
  # Pin the PUBLIC sample seed so this verifies packaged parity (the shipped app
  # only carries data/seed.sample.json), not any local private/ overlay.
  export SEED_PATH="${SEED_PATH:-data/seed.sample.json}"

  echo "==> node mode: create + seed DB at $db_path (seed=$SEED_PATH)"

  if ! out1=$(node --input-type=module -e "
import { openDatabase, seedIfEmpty, listStories } from './src/db.js';
import { existsSync } from 'node:fs';

const dbPath = process.env.DB_PATH;
const db = openDatabase(dbPath);
seedIfEmpty(db, process.env.SEED_PATH);
const stories = listStories(db);
const n = stories.length;
if (!existsSync(dbPath)) {
  console.error('DB file not created:', dbPath);
  process.exit(1);
}
if (n <= 0) {
  console.error('Expected stories > 0, got', n);
  process.exit(1);
}
console.log('VERIFY_DB_OK stories=' + n);
" 2>&1); then
    echo "$out1" >&2
    fail "node DB create/seed step exited non-zero"
    return
  fi

  echo "$out1"
  if ! echo "$out1" | grep -q 'VERIFY_DB_OK'; then
    fail "missing VERIFY_DB_OK line from node create/seed step"
    return
  fi

  story_count=$(echo "$out1" | sed -n 's/.*VERIFY_DB_OK stories=\([0-9][0-9]*\).*/\1/p')
  if [ -z "$story_count" ] || [ "$story_count" -le 0 ]; then
    fail "could not parse story count from VERIFY_DB_OK"
    return
  fi

  pass "DB created and seeded ($story_count stories)"

  echo "==> node mode: reopen same DB and verify persistence"

  export EXPECTED_STORY_COUNT="$story_count"
  if ! out2=$(node --input-type=module -e "
import { openDatabase, listStories } from './src/db.js';

const dbPath = process.env.DB_PATH;
const expected = Number(process.env.EXPECTED_STORY_COUNT);
const db = openDatabase(dbPath);
const stories = listStories(db);
const n = stories.length;
if (n !== expected) {
  console.error('Story count changed: expected ' + expected + ', got ' + n);
  process.exit(1);
}
console.log('VERIFY_PERSIST_OK');
" 2>&1); then
    echo "$out2" >&2
    fail "node persistence step exited non-zero"
    return
  fi

  echo "$out2"
  if ! echo "$out2" | grep -q 'VERIFY_PERSIST_OK'; then
    fail "missing VERIFY_PERSIST_OK line from node persistence step"
    return
  fi

  pass "stories persisted across reopen ($story_count unchanged)"
}

run_electron_mode() {
  # Requires electron installed (devDependency) and may need a display;
  # the `node` mode is the CI-safe default.
  local tmp db_path output

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  db_path="$tmp/todo.db"

  echo "==> electron mode: BOARD_SELFTEST=1 DB_PATH=$db_path"

  if ! output=$(BOARD_SELFTEST=1 DB_PATH="$db_path" npx electron . 2>&1); then
    echo "$output" >&2
    fail "electron self-test exited non-zero"
    return
  fi

  echo "$output"
  if ! echo "$output" | grep -q 'SELFTEST_OK'; then
    fail "electron output missing SELFTEST_OK"
    return
  fi

  pass "electron self-test reported SELFTEST_OK"

  if [ ! -f "$db_path" ]; then
    fail "DB file not created at $db_path after electron self-test"
    return
  fi

  pass "DB file exists at $db_path"
}

run_dmg_mode() {
  # Ultimate smoke test: mount the SHIPPED .dmg exactly as a user would, then run
  # the packaged app's BOARD_SELFTEST hook from the mounted volume against a fresh
  # temp DB. Proves the artifact boots, creates the DB, and seeds the sample.
  local dmg tmp db_path mount_dir app bin output
  local attach_out=""
  local mounted=""

  dmg="${DMG_PATH:-$(find dist -maxdepth 1 -name '*.dmg' -type f 2>/dev/null | head -n 1)}"
  if [ -z "$dmg" ] || [ ! -f "$dmg" ]; then
    fail "no .dmg found in dist/ (build it first: ./tools/build-dmg.sh)"
    return
  fi
  echo "==> dmg mode: mounting $dmg"

  tmp="$(mktemp -d)"
  mount_dir="$tmp/mnt"
  mkdir -p "$mount_dir"
  db_path="$tmp/todo.db"
  # Cleanup: always detach the volume and remove the temp dir.
  trap '[ -n "$mounted" ] && hdiutil detach "$mounted" -quiet 2>/dev/null || true; rm -rf "$tmp"' RETURN

  if ! attach_out=$(hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_dir" 2>&1); then
    echo "$attach_out" >&2
    fail "hdiutil attach failed"
    return
  fi
  mounted="$mount_dir"

  app="$(find "$mount_dir" -maxdepth 1 -name '*.app' -type d | head -n 1)"
  if [ -z "$app" ]; then
    fail "no .app found on the mounted volume"
    return
  fi
  pass "mounted volume contains $(basename "$app")"

  bin="$app/Contents/MacOS/$(basename "$app" .app)"
  if [ ! -x "$bin" ]; then
    fail "app binary not executable at $bin"
    return
  fi

  echo "==> dmg mode: running packaged self-test (seed=data/seed.sample.json)"
  if ! output=$(BOARD_SELFTEST=1 DB_PATH="$db_path" SEED_PATH="data/seed.sample.json" "$bin" 2>&1); then
    echo "$output" >&2
    fail "packaged self-test exited non-zero"
    return
  fi

  echo "$output" | grep -E 'SELFTEST_(OK|FAIL)' || true
  if ! echo "$output" | grep -q 'SELFTEST_OK'; then
    fail "packaged app did not report SELFTEST_OK"
    return
  fi
  pass "packaged app booted and reported SELFTEST_OK"

  if [ ! -f "$db_path" ]; then
    fail "DB file not created at $db_path by the packaged app"
    return
  fi
  pass "packaged app created the on-device DB"
}

case "$MODE" in
  node)
    run_node_mode
    ;;
  electron)
    run_electron_mode
    ;;
  dmg)
    run_dmg_mode
    ;;
  *)
    echo "Usage: $0 [node|electron|dmg]" >&2
    echo "  node      (default) verify DB create/seed/persist via node — CI-safe" >&2
    echo "  electron  verify via BOARD_SELFTEST=1 electron hook (dev, unpackaged)" >&2
    echo "  dmg       mount the shipped dist/*.dmg and self-test the packaged app" >&2
    exit 2
    ;;
esac

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "=== VERIFY PASS ($MODE mode) ==="
  exit 0
else
  echo "=== VERIFY FAIL ($MODE mode): $FAILURES check(s) failed ===" >&2
  exit 1
fi
