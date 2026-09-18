// Historical coverage math — pure functions, no I/O.
//
// Coverage is expressed as a set of half-open intervals [from, to) per
// repository, persisted in repo_coverage. An interval means "we scanned the
// repository's commit history over this window" — whether commits were found
// or not. `complete: true` means the interval's lower bound reached the
// repository's first commit, so everything older than `from` is known-empty
// (the interval covers (-∞, to) for coverage purposes).

export function normInterval(row) {
  return {
    from: row.covered_from ?? row.from,
    to: row.covered_to ?? row.to,
    complete: Boolean(row.complete),
  }
}

// Merge overlapping or touching intervals. `complete` is sticky: any merged
// member anchored at the repo root makes the whole interval complete.
export function mergeIntervals(intervals) {
  const sorted = [...intervals]
    .map(normInterval)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const out = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.from <= last.to) {
      if (iv.to > last.to) last.to = iv.to
      last.complete = last.complete || iv.complete
    } else {
      out.push({ ...iv })
    }
  }
  return out
}

// Insert one scanned interval into an existing set and return the merged set.
export function addInterval(intervals, interval) {
  return mergeIntervals([...(intervals || []), normInterval(interval)])
}

// Does this repo's interval set fully cover [from, to)?
// from may be null (open past — requires a complete-anchored interval).
// to may be null or in the future — coverage cannot extend past now, so the
// comparison is clamped at the current time (ISO strings compare correctly).
export function coversRange(intervals, from, to) {
  const merged = mergeIntervals(intervals)
  const now = new Date().toISOString()
  const toIso = !to || to > now ? now : to
  for (const iv of merged) {
    const coversLow = from === null ? iv.complete : iv.complete || iv.from <= from
    // Same-day grace: a repo scanned earlier today covers a range ending
    // today. Anything newer is a refresh concern, not missing history.
    const coversHigh = iv.to >= toIso || iv.to.slice(0, 10) === toIso.slice(0, 10)
    if (coversLow && coversHigh) return true
  }
  return false
}

// Earliest timestamp such that [x, latest-known] is continuously covered —
// used for "synced from <date> onward" messaging. The merged interval list is
// disjoint and sorted, so the last one reaches furthest forward. Null when
// coverage is anchored at the repo root (i.e. reaches back to -∞) or when
// there is no coverage at all — callers distinguish by checking emptiness.
export function contiguousCoverageFrom(intervals) {
  const merged = mergeIntervals(intervals)
  if (!merged.length) return undefined // no coverage
  const latest = merged[merged.length - 1]
  return latest.complete ? null : latest.from // null = covered all the way back
}

// Aggregate coverage for a user-facing date range across repositories.
// perRepoIntervals: array (one per repo) of interval arrays.
// from/to: 'YYYY-MM-DD' or null. syncing: a sync that could fill the range is
// in flight (or a targeted sync overlapping this range is running).
export function rangeCoverageStatus(perRepoIntervals, { from, to }, syncing = false) {
  const fromIso = from ? `${from}T00:00:00.000Z` : null
  const toIso = to ? `${to}T23:59:59.999Z` : null

  const covered = perRepoIntervals.map((ivs) => coversRange(ivs, fromIso, toIso))
  if (covered.length && covered.every(Boolean)) {
    return { status: 'complete', requestedFrom: from, requestedTo: to }
  }

  // Overlap: does the requested range intersect any coverage at all?
  const anyOverlap = perRepoIntervals.some((ivs) =>
    mergeIntervals(ivs).some((iv) => (!fromIso || iv.to > fromIso) && (!toIso || iv.from <= toIso))
  )

  // Earliest point from which coverage is contiguous to the newest scan for
  // every repo — only meaningful when every repo has some coverage.
  let availableFrom = null
  if (perRepoIntervals.length && perRepoIntervals.every((ivs) => ivs.length)) {
    const starts = perRepoIntervals.map((ivs) => contiguousCoverageFrom(ivs))
    // undefined = repo has no coverage; null = complete history;
    // take the latest of the partial start points
    if (!starts.includes(undefined)) {
      const partial = starts.filter(Boolean)
      availableFrom = partial.length ? partial.sort().at(-1) : null
    }
  }

  const status = syncing ? 'syncing' : anyOverlap || covered.some(Boolean) ? 'partial' : 'missing'
  return { status, requestedFrom: from, requestedTo: to, availableFrom, availableTo: to }
}

// Deterministic multi-phase progress. Never reaches 1 until every phase is
// done — a repo whose history is mid-walk contributes partial credit so the
// bar moves smoothly but cannot fake completion.
export function computeSyncProgress({ reposTotal, metaDone, historyDone, historyActive, pullsDone }) {
  if (!reposTotal) return 0
  const metaFrac = Math.min(1, metaDone / reposTotal)
  const histFrac = Math.min(1, (historyDone + historyActive * 0.5) / reposTotal)
  const pullFrac = pullsDone ? 1 : 0
  const p = 0.05 + 0.15 * metaFrac + 0.65 * histFrac + 0.15 * pullFrac
  return Math.min(p, historyDone === reposTotal && pullsDone ? 1 : 0.99)
}
