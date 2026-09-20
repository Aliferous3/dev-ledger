import { test } from 'node:test'
import assert from 'node:assert/strict'
import { longestStreak, summarizeDaily, isAttributedCommit, dayKey } from '../lib/analytics.mjs'

test('dayKey extracts YYYY-MM-DD', () => {
  assert.equal(dayKey('2026-09-16T10:22:00Z'), '2026-09-16')
  assert.equal(dayKey('2026-09-16'), '2026-09-16')
})

test('longestStreak counts consecutive days only', () => {
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak(['2026-01-01']), 1)
  assert.equal(longestStreak(['2026-01-01', '2026-01-02', '2026-01-03']), 3)
  assert.equal(longestStreak(['2026-01-01', '2026-01-03']), 1)
  // month boundary
  assert.equal(longestStreak(['2026-01-31', '2026-02-01']), 2)
  // duplicates and order
  assert.equal(longestStreak(['2026-01-02', '2026-01-01', '2026-01-02']), 2)
})

test('summarizeDaily aggregates commits/churn/streak', () => {
  const s = summarizeDaily([
    { date: '2026-03-01', commits: 2, additions: 10, deletions: 4 },
    { date: '2026-03-02', commits: 1, additions: 5, deletions: 5 },
    { date: '2026-03-04', commits: 3, additions: 0, deletions: 9 },
  ])
  assert.equal(s.commits, 6)
  assert.equal(s.added, 15)
  assert.equal(s.deleted, 18)
  assert.equal(s.net, -3)
  assert.equal(s.churn, 33)
  assert.equal(s.activeDays, 3)
  assert.equal(s.longestStreak, 2)
  assert.equal(s.peakDayCommits, 3)
})

test('summarizeDaily ignores zero-commit days for streaks', () => {
  const s = summarizeDaily([
    { date: '2026-03-01', commits: 1, additions: 1, deletions: 0 },
    { date: '2026-03-02', commits: 0, additions: 0, deletions: 0 },
    { date: '2026-03-03', commits: 1, additions: 1, deletions: 0 },
  ])
  assert.equal(s.activeDays, 2)
  assert.equal(s.longestStreak, 1)
})

test('isAttributedCommit only counts GitHub-linked author identity', () => {
  const nodeId = 'MDQ6VXNlcjk0Njk4OTI1'
  assert.equal(isAttributedCommit({ author: { user: { id: nodeId } } }, nodeId), true)
  // different user
  assert.equal(isAttributedCommit({ author: { user: { id: 'OTHER' } } }, nodeId), false)
  // unattributed commit (email not linked to any GitHub account)
  assert.equal(isAttributedCommit({ author: { user: null } }, nodeId), false)
  // bot account author without user link
  assert.equal(isAttributedCommit({ author: null }, nodeId), false)
  assert.equal(isAttributedCommit({}, nodeId), false)
  assert.equal(isAttributedCommit(null, nodeId), false)
})
