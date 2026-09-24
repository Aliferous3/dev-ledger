// Test-only helper — the single source of truth for which env names are
// secrets. Both deny lists (client source scan + built-artifact scan) derive
// from security/secret-inventory.json so a newly added secret can never be
// silently omitted from one guard while the other still passes.
// NEVER import this from production code — it lives under test/ on purpose.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const INVENTORY = JSON.parse(
  readFileSync(path.join(ROOT, 'security/secret-inventory.json'), 'utf8'),
);

// Every classified secret is browser-forbidden regardless of class —
// runtime, operator, and tooling credentials must never reach the bundle.
export const SERVER_ONLY_SECRETS = INVENTORY.secrets.map((s) => s.name);

export const NON_SECRET_CONFIG = INVENTORY.nonSecrets.map((s) => s.name);
