// Pure analytics helpers. No I/O — unit-testable.

export function dayKey(iso) {
  return String(iso).slice(0, 10)
}

// dates: iterable of 'YYYY-MM-DD' strings → longest run of consecutive days.
export function longestStreak(dates) {
  const set = new Set(dates)
  const sorted = [...set].sort()
  let best = 0
  let cur = 0
  let prev = null
  for (const d of sorted) {
    if (prev) {
      const diff = (new Date(d + 'T00:00:00Z') - new Date(prev + 'T00:00:00Z')) / 86400000
      cur = diff === 1 ? cur + 1 : 1
    } else {
      cur = 1
    }
    if (cur > best) best = cur
    prev = d
  }
  return best
}

// daily: [{date, commits, additions, deletions}] → headline summary.
export function summarizeDaily(daily) {
  const rows = daily || []
  const commits = rows.reduce((a, d) => a + (Number(d.commits) || 0), 0)
  const added = rows.reduce((a, d) => a + (Number(d.additions) || 0), 0)
  const deleted = rows.reduce((a, d) => a + (Number(d.deletions) || 0), 0)
  const activeDates = rows.filter((d) => (Number(d.commits) || 0) > 0).map((d) => dayKey(d.date))
  const peak = rows.reduce((a, b) => (b.commits > (a?.commits || 0) ? b : a), null)
  return {
    commits,
    added,
    deleted,
    net: added - deleted,
    churn: added + deleted,
    activeDays: activeDates.length,
    longestStreak: longestStreak(activeDates),
    peakDayCommits: peak?.commits || 0,
  }
}

// A GraphQL commit node counts toward the user's body of work only when
// GitHub has linked the commit's author identity to the user's account.
// Unlinked emails, bots, and co-authors are excluded automatically.
export function isAttributedCommit(node, userNodeId) {
  return Boolean(node && node.author && node.author.user && node.author.user.id === userNodeId)
}
