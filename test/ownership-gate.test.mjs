// Phase 1C-A gate contract — the hard-off feature boundary every future
// ownership runner must pass before any GitHub request or DB write.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  OWNERSHIP_FLAG_ENV,
  OWNERSHIP_ALLOWLIST_ENV,
  OwnershipDisabledError,
  isOwnershipIngestEnabled,
  canaryRepositoryIds,
  ownershipIngestAllowed,
  assertOwnershipIngestAllowed,
} = await import('../lib/ownership/gate.mjs')

const REPO_A = '11111111-2222-3333-4444-555555555555'
const REPO_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const env = (flag, list) => ({
  [OWNERSHIP_FLAG_ENV]: flag,
  [OWNERSHIP_ALLOWLIST_ENV]: list,
})

test('flag absent -> disabled', () => {
  assert.equal(isOwnershipIngestEnabled({}), false)
  assert.equal(ownershipIngestAllowed(REPO_A, env(undefined, REPO_A)), false)
})

test('flag false/malformed -> disabled', () => {
  for (const bad of ['false', '1', 'yes', 'TRUE', 'True', ' true', 'on', '0']) {
    assert.equal(isOwnershipIngestEnabled(env(bad, REPO_A)), false, `flag '${bad}'`)
    assert.equal(ownershipIngestAllowed(REPO_A, env(bad, REPO_A)), false)
  }
})

test('explicit true is the ONLY enabled literal', () => {
  assert.equal(isOwnershipIngestEnabled(env('true', REPO_A)), true)
})

test('flag true + allowlist absent/empty -> disabled for every repository', () => {
  assert.equal(ownershipIngestAllowed(REPO_A, { [OWNERSHIP_FLAG_ENV]: 'true' }), false)
  for (const empty of [undefined, '', '   ', ',', ' , , ']) {
    assert.equal(ownershipIngestAllowed(REPO_A, env('true', empty)), false, `allowlist '${empty}'`)
  }
})

test('flag true + repository not listed -> disabled', () => {
  assert.equal(ownershipIngestAllowed(REPO_A, env('true', REPO_B)), false)
})

test('flag true + listed valid repository uuid -> enabled', () => {
  assert.equal(ownershipIngestAllowed(REPO_A, env('true', REPO_A)), true)
  assert.equal(ownershipIngestAllowed(REPO_A, env('true', `${REPO_B},${REPO_A}`)), true)
})

test('malformed/non-uuid allowlist entries enable nothing', () => {
  for (const bad of ['*', 'all', 'owner/repo', 'some-login', 'not-a-uuid',
    '11111111-2222-3333-4444-55555555555', '11111111-2222-3333-4444-555555555555x']) {
    assert.equal(ownershipIngestAllowed(REPO_A, env('true', bad)), false, `entry '${bad}'`)
    assert.equal(canaryRepositoryIds(env('true', bad)).size, 0)
  }
})

test('repository argument must itself be a uuid — names/logins never match', () => {
  const e = env('true', REPO_A)
  for (const bad of ['owner/repo', 'repo-name', 'some-login', '*', '', null, undefined, 42]) {
    assert.equal(ownershipIngestAllowed(bad, e), false, `repo '${bad}'`)
  }
})

test('duplicates and whitespace are harmless; case-insensitive uuids', () => {
  const e = env('true', ` ${REPO_A} , ${REPO_A.toUpperCase()}, ${REPO_B} ,, `)
  assert.equal(canaryRepositoryIds(e).size, 2)
  assert.equal(ownershipIngestAllowed(REPO_A.toUpperCase(), e), true)
  assert.equal(ownershipIngestAllowed(REPO_B, e), true)
})

test('assertive gate throws OwnershipDisabledError when disabled', () => {
  assert.throws(() => assertOwnershipIngestAllowed(REPO_A, env('true', REPO_B)), OwnershipDisabledError)
  assert.throws(() => assertOwnershipIngestAllowed(REPO_A, env('false', REPO_A)), OwnershipDisabledError)
  // and the thrown error carries no repo id / allowlist content
  try { assertOwnershipIngestAllowed(REPO_A, env('true', REPO_B)) } catch (e) {
    assert.ok(!e.message.includes(REPO_A))
    assert.ok(!e.message.includes(REPO_B))
  }
  assert.doesNotThrow(() => assertOwnershipIngestAllowed(REPO_A, env('true', REPO_A)))
})

test('default process env cannot accidentally enable (no ambient ownership env)', () => {
  // whatever the ambient env holds, an unlisted repo is still refused
  assert.equal(ownershipIngestAllowed('cccccccc-1111-2222-3333-444444444444', {}), false)
})
