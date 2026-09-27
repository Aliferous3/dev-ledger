import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');

test('S15 Signal Weave is mounted once at the authenticated app shell', () => {
  const app = src('src/App.tsx');
  assert.match(app, /import \{ SignalWeaveSyncOverlay \}/);
  assert.equal((app.match(/<SignalWeaveSyncOverlay\s*\/>/g) || []).length, 1);
});

test('S15 Signal Weave is screen-wide, non-blocking, and sync-state driven', () => {
  const overlay = src('src/components/SignalWeaveSyncOverlay.tsx');

  assert.match(overlay, /data-sync-overlay="signal-weave-s15"/);
  assert.match(overlay, /fixed inset-0/);
  assert.match(overlay, /pointer-events-none/);
  assert.match(overlay, /sync\?\.status === 'syncing'/);
  assert.match(overlay, /pumping &&/);

  // Canonical S15 visual grammar from the supplied prototype, with the
  // production smoothing layer that bridges real ~1.5s sync updates.
  assert.match(overlay, /REAL_SYNC_TWEEN_MS = 1450/);
  assert.match(overlay, /requestAnimationFrame\(frame\)/);
  assert.match(overlay, /Math\.pow\(1 - t, 1\.6\)/);
  assert.match(overlay, /repeating-linear-gradient\(45deg/);
  assert.match(overlay, /H-AXIS/);
  assert.match(overlay, /V-AXIS/);
  assert.match(overlay, /WEAVE COMPLETE/);
});
