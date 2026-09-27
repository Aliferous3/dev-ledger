import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('public release version is stable and lockfile stays aligned', () => {
  assert.equal(pkg.version, '1.3.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.version, pkg.version);
  assert.doesNotMatch(pkg.version, /[-+]/, 'release version must not carry prerelease/build metadata');
});
