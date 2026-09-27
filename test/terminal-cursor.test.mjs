import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');

test('S10 Terminal Cursor is mounted once at the authenticated app shell', () => {
  const app = src('src/App.tsx');
  assert.match(app, /import \{ TerminalCursorSyncOverlay \}/);
  assert.equal((app.match(/<TerminalCursorSyncOverlay\s*\/>/g) || []).length, 1);
  assert.doesNotMatch(app, /SignalWeaveSyncOverlay/);
});

test('S10 Terminal Cursor preserves the supplied reference grammar', () => {
  const overlay = src('src/components/TerminalCursorSyncOverlay.tsx');

  assert.match(overlay, /data-sync-overlay="terminal-cursor-s10"/);
  assert.match(overlay, /fixed inset-0/);
  assert.match(overlay, /pointer-events-none/);
  assert.match(overlay, /sync\?\.status === 'syncing'/);
  assert.match(overlay, /pumping &&/);

  // Reference S10: full-height 3px lime head, 60px terminal underline,
  // brightened written region, giant 3-digit mono percent, and write labels.
  assert.match(overlay, /width: 3/);
  assert.match(overlay, /width: 60/);
  assert.match(overlay, /rgba\(255,255,255,\.045\)/);
  assert.match(overlay, /minimumIntegerDigits: 3/);
  assert.match(overlay, /WRITE HEAD/);
  assert.match(overlay, /WRITE COMPLETE/);
  assert.match(overlay, /CURSOR_TWEEN_MS = 1800/);
  assert.match(overlay, /translate3d/);
});
