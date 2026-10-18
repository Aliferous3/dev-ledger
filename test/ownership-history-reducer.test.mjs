// Phase 1C-A monthly history reducer contract — UTC grouping, touch
// semantics, pre-fold human counts, Top-25 + Other, unlinked semantics,
// durable-identity minimization, numeric stability, privacy output shape.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  TOP_LINKED_PER_PERIOD,
  monthStartUtc,
  shareOf,
  reduceHistoryToMonthly,
} = await import('../lib/ownership/history-reducer.mjs')
const { contributorKey, OwnershipIdentityError } = await import('../lib/ownership/contributors.mjs')

const REPO = '11111111-2222-3333-4444-555555555555'
const SCOPE = { scope_type: 'dir', display_path: 'src/api', depth: 2, scope_path_hash: 'h' }

// history nodes use the production query shape: committedDate + user {id login}
const node = (iso, user = null) => ({ committedDate: iso, author: { user } })
const user = (id, login = `u-${id}`) => ({ id, login })

/* ── month grouping ──────────────────────────────────────────────────── */

test('monthStartUtc is always the first UTC instant of the month', () => {
  assert.equal(monthStartUtc('2026-09-14T23:59:59.000Z'), '2026-09-01T00:00:00.000Z')
  assert.equal(monthStartUtc('2026-09-01T00:00:00.000Z'), '2026-09-01T00:00:00.000Z')
  // a UTC+/-offset input still lands on its UTC month — never local time
  assert.equal(monthStartUtc('2026-08-31T23:30:00-02:00'), '2026-09-01T00:00:00.000Z')
  assert.equal(monthStartUtc('2026-09-01T01:30:00+05:00'), '2026-08-01T00:00:00.000Z')
  assert.throws(() => monthStartUtc('not-a-date'), TypeError)
})

test('nodes group by UTC calendar month; empty input yields no rows', () => {
  const out = reduceHistoryToMonthly({
    repositoryId: REPO, scope: SCOPE,
    nodes: [
      node('2026-08-10T10:00:00Z', user('A')),
      node('2026-08-20T10:00:00Z', user('A')),
      node('2026-09-01T00:00:01Z', user('B')),
    ],
  })
  assert.equal(out.months.length, 2)
  assert.equal(out.months[0].period_start, '2026-08-01T00:00:00.000Z')
  assert.equal(out.months[1].period_start, '2026-09-01T00:00:00.000Z')
  assert.equal(reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes: [] }).months.length, 0)
})

/* ── touch semantics ─────────────────────────────────────────────────── */

test('touch counts and shares are node counts, not code volume', () => {
  const out = reduceHistoryToMonthly({
    repositoryId: REPO, scope: SCOPE,
    nodes: [
      node('2026-09-05T00:00:00Z', user('A')),
      node('2026-09-06T00:00:00Z', user('A')),
      node('2026-09-07T00:00:00Z', user('B')),
      node('2026-09-08T00:00:00Z'), // unlinked
    ],
  })
  const [m] = out.months
  assert.equal(m.totals.total_touch_commits, 4)
  const a = m.contributors.find((c) => c.contributor_key === contributorKey(REPO, 'A'))
  assert.equal(a.touch_commits, 2)
  assert.equal(a.touch_share, 0.5)
  assert.equal(a.identity_kind, 'linked')
  const u = m.contributors.find((c) => c.identity_kind === 'unlinked')
  assert.equal(u.touch_commits, 1)
  assert.equal(u.touch_share, 0.25)
})

test('scope totals are the authoritative denominators', () => {
  const out = reduceHistoryToMonthly({
    repositoryId: REPO, scope: SCOPE,
    nodes: [node('2026-09-01T00:00:00Z', user('A')), node('2026-09-02T00:00:00Z'), node('2026-09-03T00:00:00Z')],
  })
  const [m] = out.months
  assert.equal(m.totals.total_touch_commits, 3)
  assert.equal(m.totals.unlinked_touch_share, shareOf(2, 3)) // 0.6667
})

/* ── human count ─────────────────────────────────────────────────────── */

test('human_contributor_count is pre-fold and excludes unlinked/other/bots', () => {
  const nodes = []
  for (let i = 0; i < 30; i++) nodes.push(node('2026-09-0' + ((i % 9) + 1) + 'T00:00:00Z', user(`H${i}`)))
  nodes.push(node('2026-09-01T00:00:00Z', user('B1', 'ci[bot]')))   // bot
  nodes.push(node('2026-09-02T00:00:00Z'))                          // unlinked
  const out = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes })
  const [m] = out.months
  // 30 distinct humans — the count must NOT cap at the Top-25 fold
  assert.equal(m.totals.human_contributor_count, 30)
  assert.equal(m.totals.total_touch_commits, 32)
})

test('>25 linked humans regression: count stays the real transient count', () => {
  const nodes = []
  for (let i = 0; i < 40; i++) nodes.push(node('2026-09-05T00:00:00Z', user(`X${i}`)))
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months
  assert.equal(m.totals.human_contributor_count, 40)
})

/* ── Top-25 + Other ──────────────────────────────────────────────────── */

test('<=25 linked contributors produce no unnecessary Other row', () => {
  const nodes = []
  for (let i = 0; i < 10; i++) nodes.push(node('2026-09-0' + ((i % 9) + 1) + 'T00:00:00Z', user(`L${i}`)))
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months
  assert.equal(m.contributors.filter((c) => c.identity_kind === 'aggregate').length, 0)
  assert.equal(m.contributors.length, 10)
})

test('>25 linked fold deterministically into Top-25 + Other', () => {
  const nodes = []
  // 30 contributors: C0..C29 with descending activity 30..1 touches
  for (let i = 0; i < 30; i++) {
    for (let t = 0; t < 30 - i; t++) {
      nodes.push(node(`2026-09-${String((t % 9) + 1).padStart(2, '0')}T00:00:00Z`, user(`C${i}`)))
    }
  }
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months
  const linked = m.contributors.filter((c) => c.identity_kind === 'linked')
  assert.equal(linked.length, TOP_LINKED_PER_PERIOD)
  // Top-25 are C0..C24 by touches; C25..C29 fold into other
  const expectedKeys = new Set(Array.from({ length: 25 }, (_, i) => contributorKey(REPO, `C${i}`)))
  assert.deepEqual(new Set(linked.map((c) => c.contributor_key)), expectedKeys)
  const other = m.contributors.find((c) => c.identity_kind === 'aggregate')
  assert.equal(other.contributor_key, 'other')
  assert.equal(other.github_node_id, undefined, 'aggregate row carries no identity fields')
  assert.equal(other.display_login, undefined)
  assert.equal(other.is_bot, false)
  assert.equal(other.touch_commits, 5 + 4 + 3 + 2 + 1) // C25..C29
  assert.equal(other.touch_share, shareOf(15, m.totals.total_touch_commits))
  assert.equal(m.totals.human_contributor_count, 30, 'count is pre-fold')
})

test('unlinked is NEVER folded into Other — they are separate rows', () => {
  const nodes = []
  for (let i = 0; i < 30; i++) nodes.push(node('2026-09-05T00:00:00Z', user(`F${i}`)))
  nodes.push(node('2026-09-06T00:00:00Z'), node('2026-09-07T00:00:00Z'))
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months
  const other = m.contributors.find((c) => c.identity_kind === 'aggregate')
  const unlinked = m.contributors.find((c) => c.identity_kind === 'unlinked')
  assert.ok(other && unlinked, 'both buckets exist')
  assert.equal(unlinked.touch_commits, 2)
  assert.equal(other.touch_commits, 5) // 30 linked − 25 top
  assert.equal(unlinked.identity_kind === 'aggregate', false)
})

test('ties break deterministically by contributor key', () => {
  const nodes = []
  for (let i = 0; i < 30; i++) nodes.push(node('2026-09-05T00:00:00Z', user(`T${i}`)))
  const run = () => reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months[0]
  const first = run()
  // 30 equal contributors → exactly 25 represented + Other(5)
  assert.equal(first.contributors.filter((c) => c.identity_kind === 'linked').length, 25)
  assert.equal(first.contributors.find((c) => c.identity_kind === 'aggregate').touch_commits, 5)
  // the cut set is stable across runs — key-ascending order decides
  for (let i = 0; i < 5; i++) assert.deepEqual(run(), first)
})

/* ── durable identity minimization ───────────────────────────────────── */

test('overflow-only identities produce no durable contributor candidate', () => {
  const nodes = []
  for (let i = 0; i < 30; i++) {
    for (let t = 0; t <= 30 - i; t++) nodes.push(node('2026-09-05T00:00:00Z', user(`D${i}`)))
  }
  const out = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes })
  const candKeys = new Set(out.contributor_candidates.map((c) => c.contributor_key))
  // Top-25 + 'other' (no unlinked in this input)
  assert.equal(out.contributor_candidates.length, 26)
  assert.ok(candKeys.has('other'))
  // overflow identities D25..D29 contributed to human count + Other but got
  // no durable identity candidate
  for (let i = 25; i < 30; i++) assert.ok(!candKeys.has(contributorKey(REPO, `D${i}`)))
  for (const c of out.contributor_candidates) {
    if (c.identity_kind === 'linked') {
      assert.ok(c.github_node_id && c.display_login, 'linked candidates carry the durable pair')
      assert.ok(c.first_seen_at && c.last_seen_at, 'seen bounds tracked for contributor rows')
    } else {
      assert.equal(c.github_node_id, null)
    }
  }
})

test('a contributor represented in ANY retained month is a durable candidate', () => {
  const nodes = []
  // Z touches Sept alone (top that month); 30 others crowd October
  nodes.push(node('2026-09-01T00:00:00Z', user('Z')))
  for (let i = 0; i < 30; i++) nodes.push(node('2026-10-01T00:00:00Z', user(`O${i}`)))
  const out = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes })
  const keys = new Set(out.contributor_candidates.map((c) => c.contributor_key))
  assert.ok(keys.has(contributorKey(REPO, 'Z')), 'individually represented once → candidate')
})

/* ── numeric stability ───────────────────────────────────────────────── */

test('shares are bounded, finite, and -0-free', () => {
  assert.equal(shareOf(1, 3), 0.3333)
  assert.equal(shareOf(2, 3), 0.6667)
  assert.equal(shareOf(0, 5), 0)
  assert.equal(shareOf(1, 0), 0)
  assert.equal(shareOf(5, 0), 0, 'zero denominator → 0, never NaN')
  assert.equal(shareOf(Number.NaN, 3), 0)
  assert.equal(shareOf(1, Number.POSITIVE_INFINITY), 0)
  for (const v of [shareOf(1, 3), shareOf(0, 0)]) {
    assert.ok(v >= 0 && v <= 1 && !Object.is(v, -0) && Number.isFinite(v))
  }
})

test('rounded shares are not force-summed to 1 — totals stay authoritative', () => {
  // 3 equal contributors → 0.3333 each, sum 0.9999 — no mutation to "fix" it
  const nodes = [node('2026-09-01T00:00:00Z', user('a')), node('2026-09-02T00:00:00Z', user('b')), node('2026-09-03T00:00:00Z', user('c'))]
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }).months
  const sum = m.contributors.reduce((n, c) => n + c.touch_share, 0)
  assert.ok(Math.abs(sum - 0.9999) < 1e-9, `sum ${sum} — shares must not be mutated to sum exactly 1`)
})

/* ── privacy output shape ────────────────────────────────────────────── */

test('reducer output carries no raw nodes, SHAs, paths, emails, or messages', () => {
  const out = reduceHistoryToMonthly({
    repositoryId: REPO, scope: SCOPE,
    nodes: [
      { committedDate: '2026-09-01T00:00:00Z', oid: 'deadbeef1234', author: { user: user('A', 'alice') }, sneaky: 'payload' },
      node('2026-09-02T00:00:00Z'),
    ],
  })
  const serialized = JSON.stringify(out)
  for (const bad of ['deadbeef', 'sneaky', 'oid', 'email', 'message', 'full_name', 'committedDate']) {
    assert.ok(!serialized.includes(bad), `output leaked ${bad}`)
  }
  // allowed: period keys, classification, counts, shares, candidate identity
  const monthKeys = Object.keys(out.months[0].totals).sort()
  assert.deepEqual(monthKeys, ['human_contributor_count', 'total_touch_commits', 'unlinked_touch_share'])
})

test('contributor rows carry only the contracted fields', () => {
  const out = reduceHistoryToMonthly({
    repositoryId: REPO, scope: SCOPE,
    nodes: [node('2026-09-01T00:00:00Z', user('A', 'alice')), node('2026-09-02T00:00:00Z')],
  })
  for (const c of out.months[0].contributors) {
    assert.deepEqual(Object.keys(c).sort(),
      ['contributor_key', 'identity_kind', 'is_bot', 'touch_commits', 'touch_share'])
  }
})

/* ── input hardening ─────────────────────────────────────────────────── */

test('malformed nodes fail loudly — no silent garbage metrics', () => {
  assert.throws(() => reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes: [{}] }), TypeError)
  assert.throws(() => reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes: [node('bogus')] }), TypeError)
})

test('malformed linked identity propagates OwnershipIdentityError — no partial result', () => {
  // a present-but-broken user object is a data-contract violation mid-stream:
  // the reducer must throw, never emit months/candidates for the good nodes
  const nodes = [
    node('2026-09-01T00:00:00Z', user('A')),
    node('2026-09-02T00:00:00Z', { id: 'N_broken' }), // missing login
    node('2026-09-03T00:00:00Z', user('B')),
  ]
  assert.throws(
    () => reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes }),
    OwnershipIdentityError,
  )
  try {
    reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes })
  } catch (e) {
    for (const leak of ['N_broken', 'N_A', REPO]) {
      assert.ok(!e.message.includes(leak), `error leaked ${leak}`)
    }
  }
})

test('null/undefined/missing author.user → unlinked; non-null malformed throws', () => {
  const unlinkedNodes = [
    { committedDate: '2026-09-01T00:00:00Z' },                        // no author
    { committedDate: '2026-09-02T00:00:00Z', author: null },          // null author
    { committedDate: '2026-09-03T00:00:00Z', author: { user: null } },// null user
    node('2026-09-04T00:00:00Z'),                                     // user undefined via helper
  ]
  const [m] = reduceHistoryToMonthly({ repositoryId: REPO, scope: SCOPE, nodes: unlinkedNodes }).months
  assert.equal(m.totals.unlinked_touch_share, 1)
  const u = m.contributors.find((c) => c.identity_kind === 'unlinked')
  assert.equal(u.touch_commits, 4)
})
