import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  historyPathQuery,
  blameQuery,
  batchedBlameQuery,
  repoProbeQuery,
  tagsQuery,
  assertNoSourceFields,
  assertResponseMetadataOnly,
  FORBIDDEN_FIELD_RE,
} from '../scripts/spikes/ownership/queries.mjs'
import { makeRepoLabeler, sanitizeText, summarizeBlameRanges } from '../scripts/spikes/ownership/sanitize.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('ownership spike — query source-exposure audit', () => {
  it('no built query selects forbidden source fields', () => {
    for (const q of [historyPathQuery(), blameQuery(), batchedBlameQuery(['a', 'b']), repoProbeQuery(), tagsQuery()]) {
      assert.doesNotMatch(q, FORBIDDEN_FIELD_RE)
    }
  })

  it('assertNoSourceFields rejects source-bearing queries', () => {
    assert.throws(() => assertNoSourceFields('query { repository { object { ... on Blob { text } } } }'), /text/)
    assert.throws(() => assertNoSourceFields('... files { nodes { patch } }'), /patch/)
    assert.throws(() => assertNoSourceFields('commit { message }'), /message/)
    assert.throws(() => assertNoSourceFields('author { email }'), /email/)
  })

  it('assertNoSourceFields passes metadata-only queries', () => {
    const q = blameQuery()
    assert.equal(assertNoSourceFields(q), q)
  })

  it('assertResponseMetadataOnly flags forbidden keys in payloads', () => {
    const bad = { repository: { object: { text: 'source', blame: { ranges: [] } } } }
    assert.deepEqual(assertResponseMetadataOnly(bad), ['text'])
    const good = { repository: { object: { blame: { ranges: [{ startingLine: 1 }] } } } }
    assert.deepEqual(assertResponseMetadataOnly(good), [])
  })

  it('batched blame produces one alias per path with variables', () => {
    const q = batchedBlameQuery(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    assert.match(q, /b0: blame\(path: \$p0\)/)
    assert.match(q, /b2: blame\(path: \$p2\)/)
    assert.match(q, /\$p0: String!, \$p1: String!, \$p2: String!/)
  })

  it('history query does not select additions/deletions (whole-commit stats)', () => {
    assert.doesNotMatch(historyPathQuery(), /additions|deletions/)
  })
})

describe('ownership spike — sanitization', () => {
  it('private repo names map to stable anonymized labels', () => {
    const label = makeRepoLabeler()
    assert.equal(label('acme/secret-repo', true), 'PRIVATE_A')
    assert.equal(label('acme/other-secret', true), 'PRIVATE_B')
    assert.equal(label('acme/secret-repo', true), 'PRIVATE_A')
    assert.equal(label('public/repo', false), 'public/repo')
  })

  it('sanitizeText strips repo names, logins, and SHAs', () => {
    const sha = 'a'.repeat(40)
    const out = sanitizeText(`commit ${sha} by octocat in acme/secret-repo`, {
      repoNames: ['acme/secret-repo'],
      logins: ['octocat'],
    })
    assert.equal(out, 'commit <sha40> by <contributor> in <repo>')
  })

  it('summarizeBlameRanges counts lines, ranges, and unlinked share', () => {
    const s = summarizeBlameRanges([
      { startingLine: 1, endingLine: 10, commit: { oid: 'a'.repeat(40), author: { user: { id: '1', login: 'x' } } } },
      { startingLine: 11, endingLine: 15, commit: { oid: 'b'.repeat(40), author: { user: null } } },
    ])
    assert.equal(s.lines, 15)
    assert.equal(s.ranges, 2)
    assert.equal(s.linkedContributors, 1)
    assert.equal(s.unlinkedRanges, 1)
    assert.equal(s.linkedRangeShare, 0.5)
  })
})

describe('ownership spike — isolation invariants', () => {
  it('spike modules do not import the database or persistence layer', () => {
    for (const f of [
      '../scripts/spikes/ownership-graphql-spike.mjs',
      '../scripts/spikes/ownership/queries.mjs',
      '../scripts/spikes/ownership/sanitize.mjs',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
      const imports = src.split('\n').filter((l) => /^\s*import |from '.*'|import\(/.test(l)).join('\n')
      assert.doesNotMatch(imports, /db\.mjs|supabase|@supabase/i)
    }
  })

  it('spike entry carries the no-persistence banner', () => {
    const src = fs.readFileSync(path.join(__dirname, '../scripts/spikes/ownership-graphql-spike.mjs'), 'utf8')
    assert.match(src, /THIS SPIKE MUST NOT PERSIST OWNERSHIP DATA/)
  })
})
