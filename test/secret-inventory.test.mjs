import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  INVENTORY,
  SERVER_ONLY_SECRETS,
  NON_SECRET_CONFIG,
} from './secret-inventory.mjs';

const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const SECRET_CLASSES = new Set(['runtime', 'operator', 'tooling']);
const SECRET_FIELDS = new Set([
  'name', 'purpose', 'class', 'storage', 'productionRequired', 'provider',
  'requiresRedeploy', 'rotationOverlap', 'invalidatesSessions', 'rotationImpact',
]);
const NON_SECRET_FIELDS = new Set(['name', 'purpose']);

// Public config names that must NEVER be classified as secrets. Derived from
// actual process.env reads in lib/api/scripts — extend only when a genuinely
// non-secret variable is added.
const KNOWN_PUBLIC_CONFIG = [
  'APP_URL',
  'SUPABASE_URL',
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_CLIENT_ID',
  'SESSION_LEASE_MINUTES',
  'SUPABASE_DB_HOST',
  'SUPABASE_DB_PORT',
];

test('inventory schema is strict — required fields, known classes, no extras', () => {
  assert.ok(Array.isArray(INVENTORY.secrets) && INVENTORY.secrets.length > 0);
  assert.ok(Array.isArray(INVENTORY.nonSecrets) && INVENTORY.nonSecrets.length > 0);
  for (const s of INVENTORY.secrets) {
    assert.match(s.name, /^[A-Z][A-Z0-9_]*$/, `malformed secret name ${s.name}`);
    for (const key of Object.keys(s)) {
      assert.ok(SECRET_FIELDS.has(key), `${s.name} has unexpected field "${key}"`);
    }
    for (const field of ['purpose', 'class', 'storage', 'provider', 'rotationImpact']) {
      assert.equal(typeof s[field], 'string', `${s.name}.${field} must be a string`);
      assert.ok(s[field].length > 0, `${s.name}.${field} is empty`);
    }
    for (const field of ['productionRequired', 'requiresRedeploy', 'rotationOverlap', 'invalidatesSessions']) {
      assert.equal(typeof s[field], 'boolean', `${s.name}.${field} must be a boolean`);
    }
    assert.ok(SECRET_CLASSES.has(s.class), `${s.name} class "${s.class}" unknown`);
  }
  for (const s of INVENTORY.nonSecrets) {
    assert.match(s.name, /^[A-Z][A-Z0-9_]*$/, `malformed config name ${s.name}`);
    for (const key of Object.keys(s)) {
      assert.ok(NON_SECRET_FIELDS.has(key), `${s.name} has unexpected field "${key}"`);
    }
  }
});

test('inventory contains no secret values — metadata only', () => {
  const raw = src('security/secret-inventory.json');
  // no high-entropy credential material anywhere in the file
  assert.doesNotMatch(raw, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(raw, /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/);
  assert.doesNotMatch(raw, /github_pat_[A-Za-z0-9_]{20,}/);
  assert.doesNotMatch(raw, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/);
  assert.doesNotMatch(raw, /sb_(?:secret|publishable)_[A-Za-z0-9]{10,}/);
  // no field may carry a "value"
  const forbiddenKeys = /"(?:value|secret_value|key_value|token|password|private_key)"\s*:/i;
  assert.doesNotMatch(raw, forbiddenKeys);
});

test('public configuration is not mislabeled as secret', () => {
  for (const name of KNOWN_PUBLIC_CONFIG) {
    assert.ok(!SERVER_ONLY_SECRETS.includes(name), `${name} must not be a secret`);
    assert.ok(NON_SECRET_CONFIG.includes(name), `${name} must be listed in nonSecrets`);
  }
  // and no secret sneaks into the public list
  for (const name of NON_SECRET_CONFIG) {
    assert.ok(!SERVER_ONLY_SECRETS.includes(name), `${name} is in both lists`);
  }
});

test('every inventory secret is documented in docs/secret-rotation.md', () => {
  const doc = src('docs/secret-rotation.md');
  for (const name of SERVER_ONLY_SECRETS) {
    assert.ok(
      new RegExp(`^#+ \`?${name}\`?`, 'm').test(doc),
      `${name} missing a section heading in docs/secret-rotation.md`,
    );
  }
});

test('both browser guards consume the shared inventory — no private lists', () => {
  for (const file of ['test/supply-chain.test.mjs', 'test/security.test.mjs']) {
    const content = src(file);
    assert.ok(
      content.includes("from './secret-inventory.mjs'"),
      `${file} does not import the shared inventory`,
    );
    for (const name of SERVER_ONLY_SECRETS) {
      assert.ok(
        !content.includes(`'${name}'`),
        `${file} hardcodes ${name} — add it to the inventory instead`,
      );
    }
  }
});

test('SECURITY_EVENT_HASH_KEY is classified server-only and covered by guards', () => {
  assert.ok(SERVER_ONLY_SECRETS.includes('SECURITY_EVENT_HASH_KEY'));
  const env = src('.env.example');
  assert.match(env, /^SECURITY_EVENT_HASH_KEY=$/m, '.env.example must list it as an empty placeholder');
});

test('every runtime secret appears in .env.example as a placeholder', () => {
  const env = src('.env.example');
  for (const s of INVENTORY.secrets) {
    if (s.class !== 'runtime') continue;
    assert.match(
      env,
      new RegExp(`^${s.name}=$`, 'm'),
      `${s.name} missing from .env.example`,
    );
  }
});

test('secret inventory is never imported by production code', () => {
  const targets = ['src', 'lib', 'api', 'scripts'];
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|ts|tsx|jsx)$/.test(e.name)) {
        if (readFileSync(path.join(ROOT, p), 'utf8').includes('secret-inventory')) offenders.push(p);
      }
    }
  };
  for (const t of targets) {
    if (!existsSync(path.join(ROOT, t))) continue;
    walk(t);
  }
  assert.deepEqual(offenders, [], `production files reference the inventory: ${offenders}`);
});
