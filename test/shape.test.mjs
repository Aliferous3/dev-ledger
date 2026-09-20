import { test } from 'node:test'
import assert from 'node:assert/strict'

// Shape-of-work derivations: deterministic functions over stored commit rows.
// Covers lifecycle classification, era boundaries, language strata, migration
// runs, and the fingerprint normalization contract.

const { monthIdx, idxMonth, buildRepoSpans, buildLangStrata, buildMigration, buildFingerprint } =
  await import('../src/retained/shape.js')

const REPOS = [
  { id: 'r1', name: 'alpha', path: 'me/alpha', private: false, primaryLanguage: 'TypeScript', languageBytes: 1000 },
  { id: 'r2', name: 'beta', path: 'me/beta', private: true, primaryLanguage: 'Python', languageBytes: 500 },
]
const M = (rid, month, commits = 1, added = 10, deleted = 2, days = 1) =>
  ({ repository_id: rid, month, commits, added, deleted, activeDays: days })
const spanIdx = (a, b) => { const o = []; for (let i = monthIdx(a); i <= monthIdx(b); i++) o.push(i); return o }
const NOW = monthIdx('2025-06')

test('monthIdx/idxMonth round-trip', () => {
  assert.equal(monthIdx('2024-03'), 2024 * 12 + 3)
  assert.equal(idxMonth(2024 * 12 + 3), '2024-03')
  assert.equal(idxMonth(monthIdx('2024-12')), '2024-12') // December must not roll into the next year
  assert.equal(idxMonth(monthIdx('2025-01')), '2025-01')
})

test('buildRepoSpans: active repo classification', () => {
  const spans = buildRepoSpans([M('r1', '2025-05'), M('r1', '2025-06', 5)], REPOS, NOW)
  assert.equal(spans.length, 1)
  assert.equal(spans[0].state, 'ACTIVE')
  assert.equal(spans[0].returns.length, 0)
  assert.equal(spans[0].commits, 6)
})

test('buildRepoSpans: revived after a >=3-month gap', () => {
  const spans = buildRepoSpans([M('r1', '2024-01'), M('r1', '2024-02'), M('r1', '2025-06')], REPOS, NOW)
  assert.equal(spans[0].state, 'REVIVED')
  assert.equal(spans[0].returns.length, 1)
  assert.equal(spans[0].returns[0].months, 15) // Mar 2024 .. May 2025
})

test('buildRepoSpans: quiescent and dormant thresholds', () => {
  const q = buildRepoSpans([M('r1', '2025-02'), M('r1', '2025-03')], REPOS, NOW)[0]
  assert.equal(q.state, 'QUIESCENT') // Apr+May silent = 2+ months
  const d = buildRepoSpans([M('r1', '2024-06')], REPOS, NOW)[0]
  assert.equal(d.state, 'DORMANT') // 12 months silent
})

test('buildRepoSpans: sorted by churn desc, churn = added + deleted', () => {
  const spans = buildRepoSpans(
    [M('r1', '2025-06', 1, 10, 2), M('r2', '2025-06', 1, 900, 100)],
    REPOS, NOW
  )
  assert.equal(spans[0].id, 'r2')
  assert.equal(spans[0].churn, 1000)
})

test('buildLangStrata: per-month presence share of active repos', () => {
  const repoLangs = new Map([
    ['r1', [{ language: 'TypeScript', bytes: 900 }, { language: 'CSS', bytes: 100 }]],
    ['r2', [{ language: 'Python', bytes: 500 }]],
  ])
  const strata = buildLangStrata([M('r1', '2024-01'), M('r2', '2024-02')], repoLangs)
  const jan = strata.at('2024-01')
  assert.equal(jan.find((x) => x.language === 'TypeScript').share, 0.9)
  assert.equal(jan.find((x) => x.language === 'Python').share, 0)
  assert.equal(strata.at('2024-02').find((x) => x.language === 'Python').share, 1)
  assert.equal(strata.order[0], 'TypeScript')
})

test('buildMigration: runs compress, concurrency flagged at 30%', () => {
  const monthly = [
    M('r1', '2024-01', 10), M('r1', '2024-02', 10), M('r2', '2024-02', 4), // Feb: r2 at 29% — not concurrent
    M('r1', '2024-03', 6), M('r2', '2024-03', 4), // 40% — concurrent
    M('r2', '2024-04', 10), M('r2', '2024-05', 10),
  ]
  const runs = buildMigration(monthly, new Map(REPOS.map((r) => [r.id, r])), spanIdx('2024-01', '2024-05'))
  assert.equal(runs.length, 2)
  assert.equal(runs[0].name, 'alpha')
  assert.equal(runs[0].months, 3)
  assert.equal(runs[0].concurrentMonths, 1)
  assert.equal(runs[1].name, 'beta')
})

test('buildFingerprint: deterministic normalized dims', () => {
  const dims = buildFingerprint({
    commits: 100, added: 8000, deleted: 2000, activeDays: 20, rangeDays: 30,
    reposWithActivity: { count: 3, topShare: 0.6 }, totalRepos: 5,
    prs: 25, langShares: [0.5, 0.3, 0.2],
  })
  assert.equal(dims.length, 9)
  for (const d of dims) assert.ok(d.value >= 0 && d.value <= 1, d.key)
  assert.equal(dims.find((d) => d.key === 'creation').value, 0.8)
  assert.equal(dims.find((d) => d.key === 'cadence').value, 100 / 20 / 8)
  assert.equal(dims.find((d) => d.key === 'consistency').value, 20 / 30)
  // different period → different glyph
  const dims2 = buildFingerprint({
    commits: 5, added: 100, deleted: 900, activeDays: 4, rangeDays: 30,
    reposWithActivity: { count: 1, topShare: 1 }, totalRepos: 5, prs: 0, langShares: [1],
  })
  assert.notEqual(dims2.find((d) => d.key === 'creation').value, 0.8)
  assert.equal(dims2.find((d) => d.key === 'diversity').value, 0)
})

test('buildFingerprint: zero-activity period stays bounded', () => {
  const dims = buildFingerprint({
    commits: 0, added: 0, deleted: 0, activeDays: 0, rangeDays: 7,
    reposWithActivity: { count: 0, topShare: 0 }, totalRepos: 3, prs: 0, langShares: [1],
  })
  for (const d of dims) assert.ok(d.value >= 0 && d.value <= 1, d.key)
})
