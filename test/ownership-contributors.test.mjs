// Phase 1C-A contributor identity contract — node-id durable keys,
// repository scoping, single unlinked bucket, conservative bot heuristic.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  UNLINKED_KEY,
  OTHER_KEY,
  contributorKey,
  isBotLogin,
  unlinkedContributor,
  otherContributor,
  classifyAuthorIdentity,
  isHumanMetricBasis,
} = await import('../lib/ownership/contributors.mjs')

const REPO_A = '11111111-2222-3333-4444-555555555555'
const REPO_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/* ── linked keys ─────────────────────────────────────────────────────── */

test('durable key is derived from repository boundary + GitHub node id', () => {
  const k = contributorKey(REPO_A, 'MDQ6VXNlcjE=')
  assert.match(k, /^[0-9a-f]{64}$/)
  assert.equal(k, contributorKey(REPO_A, 'MDQ6VXNlcjE='), 'deterministic')
})

test('login rename does NOT change the contributor key', () => {
  const before = classifyAuthorIdentity({ id: 'N_1', login: 'oldname' }, REPO_A)
  const after = classifyAuthorIdentity({ id: 'N_1', login: 'newname' }, REPO_A)
  assert.equal(before.contributor_key, after.contributor_key)
  assert.equal(after.display_login, 'newname', 'display_login is refreshed, key is not')
})

test('same GitHub node id in two repositories gets different keys', () => {
  assert.notEqual(contributorKey(REPO_A, 'N_1'), contributorKey(REPO_B, 'N_1'))
})

test('key is opaque — embeds no login, node id, or repo id', () => {
  const k = contributorKey(REPO_A, 'N_secret_node')
  assert.ok(!k.includes('N_secret'))
  assert.ok(!k.includes('11111111'))
})

test('missing repo id or node id is a programming error, not a bucket', () => {
  assert.throws(() => contributorKey('', 'N_1'), TypeError)
  assert.throws(() => contributorKey(REPO_A, ''), TypeError)
  assert.throws(() => contributorKey(REPO_A, null), TypeError)
})

/* ── classification ──────────────────────────────────────────────────── */

test('linked identity carries node id + login; reserved keys never collide', () => {
  const c = classifyAuthorIdentity({ id: 'N_9', login: 'alice' }, REPO_A)
  assert.equal(c.identity_kind, 'linked')
  assert.equal(c.github_node_id, 'N_9')
  assert.equal(c.display_login, 'alice')
  assert.equal(c.is_bot, false)
  assert.ok(c.contributor_key !== UNLINKED_KEY && c.contributor_key !== OTHER_KEY)
})

test('author.user == null → the single unlinked bucket', () => {
  const c = classifyAuthorIdentity(null, REPO_A)
  assert.deepEqual(c, {
    identity_kind: 'unlinked',
    contributor_key: 'unlinked',
    github_node_id: null,
    display_login: null,
    is_bot: false,
  })
  assert.deepEqual(classifyAuthorIdentity(undefined, REPO_A), c)
  assert.deepEqual(unlinkedContributor(), c)
})

test('malformed linked identity collapses to unlinked, never fabricated', () => {
  for (const bad of [{ id: '', login: 'x' }, { id: 'N_1' }, { login: 'x' }, {}, { id: 7, login: 'x' }]) {
    assert.equal(classifyAuthorIdentity(bad, REPO_A).identity_kind, 'unlinked')
  }
})

test('synthetic buckets are fixed-shape, identity-free, non-human', () => {
  for (const c of [unlinkedContributor(), otherContributor()]) {
    assert.equal(c.github_node_id, null)
    assert.equal(c.display_login, null)
    assert.equal(c.is_bot, false)
    assert.equal(isHumanMetricBasis(c), false)
  }
  assert.equal(otherContributor().identity_kind, 'aggregate')
  assert.equal(otherContributor().contributor_key, 'other')
})

/* ── bot heuristic ───────────────────────────────────────────────────── */

test('[bot] suffix marks linked identities as bots', () => {
  for (const login of ['dependabot[bot]', 'github-actions[bot]', 'renovate[bot]', 'x[BOT]']) {
    assert.equal(isBotLogin(login), true, login)
    assert.equal(classifyAuthorIdentity({ id: 'N_b', login }, REPO_A).is_bot, true)
  }
})

test('no broad username guessing — plain substrings are not bots', () => {
  for (const login of ['robot', 'botany', 'abott', 'bot', 'botsworth', 'mybot', 'bot-user']) {
    assert.equal(isBotLogin(login), false, login)
  }
  for (const bad of [null, undefined, 42]) assert.equal(isBotLogin(bad), false)
})

test('human metric basis = linked AND not bot — nothing else', () => {
  assert.equal(isHumanMetricBasis(classifyAuthorIdentity({ id: 'N_1', login: 'alice' }, REPO_A)), true)
  assert.equal(isHumanMetricBasis(classifyAuthorIdentity({ id: 'N_1', login: 'ci[bot]' }, REPO_A)), false)
  assert.equal(isHumanMetricBasis(unlinkedContributor()), false)
  assert.equal(isHumanMetricBasis(otherContributor()), false)
})

test('identity model never requests or derives email/name/databaseId', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const raw = readFileSync(join(fileURLToPath(import.meta.url), '../../lib/ownership/contributors.mjs'), 'utf8')
  // comments may document the prohibition — audit executable code only
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const bad of ['email', 'databaseId', 'author.name', 'committer', 'avatar']) {
    assert.doesNotMatch(code, new RegExp(`\\b${bad}\\b`, 'i'), `contributors must not handle ${bad}`)
  }
})
