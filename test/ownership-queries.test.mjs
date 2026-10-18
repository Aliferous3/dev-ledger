// Phase 1C-A production query contract — the metadata-only audit applies to
// the query STRINGS, not just runtime discipline. A field added to a builder
// later fails here.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  FORBIDDEN_OWNERSHIP_FIELD_RE,
  BLAME_BATCH_LIMIT,
  historyPathQuery,
  batchedBlameQuery,
  assertOwnershipQuerySafe,
} = await import('../lib/ownership/queries.mjs')

const ALL_QUERIES = {
  history: historyPathQuery(),
  blame50: batchedBlameQuery(Array.from({ length: 50 }, (_, i) => `p${i}`)),
}

/* ── forbidden-field audit ───────────────────────────────────────────── */

test('every production query is metadata-only', () => {
  for (const [name, q] of Object.entries(ALL_QUERIES)) {
    assert.doesNotMatch(q, FORBIDDEN_OWNERSHIP_FIELD_RE, `${name} selects a forbidden field`)
    assert.doesNotThrow(() => assertOwnershipQuerySafe(q), name)
  }
})

test('forbidden classes: source, content, message, email, stats are absent', () => {
  for (const bad of ['text', 'byteSize', 'patch', 'diff', 'message',
    'messageHeadline', 'messageBody', 'email', 'signature', 'committer',
    'files', 'changedFiles', 'additions', 'deletions', 'databaseId',
    'isTruncated', 'parents']) {
    for (const [name, q] of Object.entries(ALL_QUERIES)) {
      assert.doesNotMatch(q, new RegExp(`\\b${bad}\\b`), `${name} selects ${bad}`)
    }
  }
})

test('no Blob/object-content selection can appear', () => {
  for (const [name, q] of Object.entries(ALL_QUERIES)) {
    assert.doesNotMatch(q, /\.\.\.\s*on\s+Blob/i, `${name} reaches Blob content`)
    assert.doesNotMatch(q, /Blob\b/, `${name} references Blob`)
  }
})

test('identity selection is exactly user { id login } — no name/email creep', () => {
  for (const [name, q] of Object.entries(ALL_QUERIES)) {
    const blocks = q.match(/user\s*\{[^}]*\}/g) ?? []
    assert.ok(blocks.length > 0, `${name} must select user identity`)
    for (const b of blocks) assert.match(b, /^user\s*\{\s*id\s+login\s*\}$/)
  }
})

/* ── history(path:) shape ────────────────────────────────────────────── */

test('history query selects only the reducer contract fields', () => {
  const q = historyPathQuery()
  assert.match(q, /history\(first: 100, path: \$path, after: \$cursor\)/)
  assert.match(q, /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/)
  assert.match(q, /committedDate/)
  assert.match(q, /author\s*\{\s*user\s*\{\s*id\s+login\s*\}\s*\}/)
  assert.match(q, /rateLimit\s*\{\s*cost\s+remaining\s+resetAt\s*\}/)
  // oid is deliberately NOT selected — the Phase-1C reducer does not need it
  assert.doesNotMatch(q, /\boid\b/)
  // no whole-commit stats — measured to be repo-wide, never path metrics
  assert.doesNotMatch(q, /\b(additions|deletions|changedFiles)\b/)
})

/* ── batched blame shape ─────────────────────────────────────────────── */

test('batched blame is capped at the measured 50-alias ceiling', () => {
  assert.equal(BLAME_BATCH_LIMIT, 50)
  assert.throws(() => batchedBlameQuery(Array(51).fill('x')), RangeError)
  assert.throws(() => batchedBlameQuery([]), RangeError)
  const q = batchedBlameQuery(['a', 'b'])
  assert.match(q, /b0: blame\(path: \$p0\)/)
  assert.match(q, /b1: blame\(path: \$p1\)/)
  assert.match(q, /rateLimit\s*\{/)
})

/* ── audit function itself ───────────────────────────────────────────── */

test('assertOwnershipQuerySafe rejects widened selections', () => {
  const good = 'nodes { committedDate author { user { id login } } }'
  assert.doesNotThrow(() => assertOwnershipQuerySafe(good))
  for (const bad of [
    'nodes { committedDate message }',
    'nodes { committedDate author { user { id login name } } }',
    'nodes { committedDate author { user { id login email } } }',
    'object { ... on Blob { text } }',
    'commit { oid additions deletions }',
  ]) {
    assert.throws(() => assertOwnershipQuerySafe(bad), /forbidden|non-contract/, bad)
  }
})

test('no unmeasured GraphQL tree route exists in the production family', async () => {
  const mod = await import('../lib/ownership/queries.mjs')
  assert.equal(mod.treeEntriesQuery, undefined,
    'tree enumeration is measured only via the REST recursive git tree — '
    + 'a GraphQL entries route may not be introduced unmeasured')
})

test('runtime code never imports the spike query module', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join, dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const dir of ['lib', 'api', 'src']) {
    for (const f of readdirSync(join(ROOT, dir), { recursive: true })) {
      const rel = String(f).replaceAll('\\', '/')
      if (!/\.(mjs|ts|tsx|js|jsx)$/.test(rel)) continue
      const text = readFileSync(join(ROOT, dir, rel), 'utf8')
      assert.doesNotMatch(text, /(?:from|import)\s*['"(][^'"]*spikes\//,
        `${dir}/${rel} must not import the spike module`)
    }
  }
})
