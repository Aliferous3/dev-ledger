// Deterministic "shape of work" derivations — every output traces to stored
// GitHub-ingested rows (commits/pull_requests/repository_languages) via the
// dashboard's workShape payload. No inference, no scoring, no narratives.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7))
export const idxMonth = (i) => {
  const y = Math.floor((i - 1) / 12)
  return `${y}-${String(i - y * 12).padStart(2, '0')}`
}
export const monthName = (m) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1].toUpperCase()} ${m.slice(0, 4)}`

// Lifecycle thresholds — explicit, in months of inactivity.
export const RETURN_MIN_GAP = 3 // ≥3 inactive months between active months = a departure+return
export const QUIESCENT_AFTER = 2 // 2–5 months since last activity
export const DORMANT_AFTER = 6 // ≥6 months since last activity
export const LIFECYCLE_DEFS = [
  ['ACTIVE', 'activity within the last month'],
  ['REVIVED', 'resumed after a ≥3-month gap, active now'],
  ['QUIESCENT', 'inactive 2–5 months after prior activity'],
  ['DORMANT', 'no observed activity for 6+ months'],
]

export function buildRepoSpans(repoMonthly, repos, nowIdx) {
  const byId = new Map(repos.map((r) => [r.id, r]))
  const byRepo = new Map()
  for (const m of repoMonthly) {
    const e = byRepo.get(m.repository_id) || { months: [], commits: 0, added: 0, deleted: 0, activeDays: 0 }
    e.months.push(m)
    e.commits += m.commits
    e.added += m.added
    e.deleted += m.deleted
    e.activeDays += m.activeDays
    byRepo.set(m.repository_id, e)
  }
  const spans = []
  for (const [id, e] of byRepo) {
    const repo = byId.get(id) || {}
    e.months.sort((a, b) => a.month.localeCompare(b.month))
    const idxs = e.months.map((m) => monthIdx(m.month))
    const gaps = []
    const returns = []
    for (let i = 1; i < idxs.length; i++) {
      const g = idxs[i] - idxs[i - 1] - 1
      if (g > 0) gaps.push({ after: idxMonth(idxs[i - 1]), before: idxMonth(idxs[i]), months: g })
      if (g >= RETURN_MIN_GAP) returns.push({ left: idxMonth(idxs[i - 1]), back: idxMonth(idxs[i]), months: g })
    }
    const since = nowIdx - idxs[idxs.length - 1]
    const hadBigGap = gaps.some((g) => g.months >= RETURN_MIN_GAP)
    const state =
      since >= DORMANT_AFTER ? 'DORMANT' : since >= QUIESCENT_AFTER ? 'QUIESCENT' : hadBigGap ? 'REVIVED' : 'ACTIVE'
    spans.push({
      id,
      name: repo.name || 'repository',
      path: repo.path || repo.name || '',
      private: !!repo.private,
      lang: repo.primaryLanguage || '',
      bytes: repo.languageBytes || 0,
      first: idxMonth(idxs[0]),
      last: idxMonth(idxs[idxs.length - 1]),
      commits: e.commits,
      churn: e.added + e.deleted,
      activeDays: e.activeDays,
      months: idxs,
      returns,
      state,
    })
  }
  return spans.sort((a, b) => b.churn - a.churn)
}

// Era segmentation: a boundary opens when a different repository becomes the
// month's dominant commit source AND that dominance persists into the next
// month (a one-month flare does not end an era). A ≥3-month silence also
// closes an era. Classes are measured, not named poetically:
//   CONCENTRATED ≥70% of era commits in one repo, MIXED 40–70%, else DISTRIBUTED.
export function buildEras(repoMonthly, repoById, spanMonths) {
  const perMonth = new Map()
  for (const m of repoMonthly) {
    const e = perMonth.get(m.month) || { commits: 0, churn: 0, repos: new Map() }
    e.commits += m.commits
    e.churn += m.added + m.deleted
    e.repos.set(m.repository_id, (e.repos.get(m.repository_id) || 0) + m.commits)
    perMonth.set(m.month, e)
  }
  if (!perMonth.size || !spanMonths.length) return []
  const rows = spanMonths.map((i) => {
    const m = idxMonth(i)
    const e = perMonth.get(m)
    if (!e || !e.commits) return { month: m, idx: i, commits: 0, churn: 0, dominant: null, share: 0, repoCount: 0 }
    let dom = null, best = 0
    for (const [rid, c] of e.repos) if (c > best) { best = c; dom = rid }
    return { month: m, idx: i, commits: e.commits, churn: e.churn, dominant: dom, share: best / e.commits, repoCount: e.repos.size }
  })
  const boundaries = [0]
  let lastActive = null
  let prevActive = null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.dominant) continue
    if (lastActive) {
      const gap = r.idx - lastActive.idx - 1
      const next = rows[i + 1]
      // dominant change must persist into the next month to open an era —
      // and a return to the pre-flare dominant is a revert, not a boundary
      const confirms = !next || !next.dominant || next.dominant === r.dominant
      const reverts = prevActive && prevActive.dominant === r.dominant
      if (gap >= 3 || (r.dominant !== lastActive.dominant && confirms && !reverts)) boundaries.push(i)
    }
    prevActive = lastActive
    lastActive = r
  }
  boundaries.push(rows.length)
  const seen = new Set()
  const eras = []
  for (let b = 0; b < boundaries.length - 1; b++) {
    const seg = rows.slice(boundaries[b], boundaries[b + 1])
    const active = seg.filter((r) => r.dominant)
    if (!active.length) continue
    const commits = active.reduce((a, r) => a + r.commits, 0)
    const churn = active.reduce((a, r) => a + r.churn, 0)
    const repoTotals = new Map()
    for (const r of active) for (const [rid, c] of perMonth.get(r.month).repos) repoTotals.set(rid, (repoTotals.get(rid) || 0) + c)
    let dom = null, best = 0
    for (const [rid, c] of repoTotals) if (c > best) { best = c; dom = rid }
    const topShare = commits ? best / commits : 0
    const repoSet = new Set(repoTotals.keys())
    const newRepos = [...repoSet].filter((r) => !seen.has(r))
    repoSet.forEach((r) => seen.add(r))
    eras.push({
      from: active[0].month,
      to: active[active.length - 1].month,
      commits,
      churn,
      repoCount: repoSet.size,
      dominantRepo: repoById.get(dom)?.name || 'repository',
      topShare,
      newRepoCount: newRepos.length,
      cls: topShare >= 0.7 ? 'CONCENTRATED' : topShare >= 0.4 ? 'MIXED' : 'DISTRIBUTED',
    })
  }
  return eras
}

// Language succession — for each month, the language byte vector of the
// repositories ACTIVE that month (current per-repo language bytes are the only
// language signal GitHub exposes; this is a presence model, not byte history).
export function buildLangStrata(repoMonthly, repoLangs) {
  const perMonth = new Map()
  for (const m of repoMonthly) {
    const vec = repoLangs.get(m.repository_id) || []
    const e = perMonth.get(m.month) || new Map()
    for (const l of vec) e.set(l.language, (e.get(l.language) || 0) + Number(l.bytes || 0))
    perMonth.set(m.month, e)
  }
  const langTotals = new Map()
  for (const e of perMonth.values()) for (const [l, b] of e) langTotals.set(l, (langTotals.get(l) || 0) + b)
  const order = [...langTotals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l)
  const months = [...perMonth.keys()].sort()
  return {
    order,
    months,
    at: (month) => {
      const e = perMonth.get(month) || new Map()
      const total = [...e.values()].reduce((a, b) => a + b, 0) || 1
      return order.map((l) => ({ language: l, bytes: e.get(l) || 0, share: (e.get(l) || 0) / total }))
    },
  }
}

// Work migration — runs of consecutive months dominated by one repository.
// A month is CONCURRENT when a second repository holds ≥30% of its commits.
export function buildMigration(repoMonthly, repoById, spanMonths) {
  const perMonth = new Map()
  for (const m of repoMonthly) {
    const e = perMonth.get(m.month) || new Map()
    e.set(m.repository_id, (e.get(m.repository_id) || 0) + m.commits)
    perMonth.set(m.month, e)
  }
  const rows = spanMonths.map((i) => {
    const e = perMonth.get(idxMonth(i))
    if (!e) return null
    const sorted = [...e.entries()].sort((a, b) => b[1] - a[1])
    const total = sorted.reduce((a, [, c]) => a + c, 0)
    return { dominant: sorted[0][0], second: sorted[1]?.[0] || null, concurrent: sorted[1] && sorted[1][1] / total >= 0.3 }
  })
  const runs = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const m = idxMonth(spanMonths[i])
    const last = runs[runs.length - 1]
    if (last && last.repo === r.dominant) {
      last.to = m
      last.months++
      if (r.concurrent) last.concurrentMonths++
    } else {
      runs.push({ repo: r.dominant, from: m, to: m, months: 1, concurrentMonths: r.concurrent ? 1 : 0 })
    }
  }
  return runs.map((r) => ({ ...r, name: repoById.get(r.repo)?.name || 'repository' }))
}

// Fingerprint — 9 normalized dimensions of the selected period. Each maps to
// [0,1]; caps are fixed constants so the glyph is deterministic.
export function buildFingerprint({ commits, added, deleted, activeDays, rangeDays, reposWithActivity, totalRepos, prs, langShares }) {
  const churn = added + deleted
  const clamp = (v) => Math.max(0, Math.min(1, v || 0))
  const entropy = (() => {
    const ps = (langShares || []).filter((p) => p > 0)
    if (ps.length <= 1) return 0
    return -ps.reduce((a, p) => a + p * Math.log(p), 0) / Math.log(ps.length)
  })()
  const dims = [
    { key: 'creation', label: 'CREATION', value: clamp(churn ? added / churn : 0.5), raw: churn ? `${Math.round((added / churn) * 100)}% added` : '—' },
    { key: 'churnRate', label: 'SWEEP', value: clamp(commits ? churn / commits / 2000 : 0), raw: commits ? `${Math.round(churn / commits)} lines/commit` : '—' },
    { key: 'focus', label: 'FOCUS', value: clamp(reposWithActivity?.topShare ?? 0), raw: reposWithActivity ? `${Math.round((reposWithActivity.topShare || 0) * 100)}% top repo` : '—' },
    { key: 'breadth', label: 'BREADTH', value: clamp(totalRepos ? (reposWithActivity?.count || 0) / totalRepos : 0), raw: `${reposWithActivity?.count || 0}/${totalRepos || 0} repos` },
    { key: 'diversity', label: 'DIVERSITY', value: clamp(entropy), raw: `${(langShares || []).filter((p) => p > 0).length} languages` },
    { key: 'cadence', label: 'CADENCE', value: clamp(activeDays ? commits / activeDays / 8 : 0), raw: activeDays ? `${(commits / activeDays).toFixed(1)} commits/day` : '—' },
    { key: 'density', label: 'DENSITY', value: clamp(activeDays ? churn / activeDays / 5000 : 0), raw: activeDays ? `${Math.round(churn / activeDays)} lines/active-day` : '—' },
    { key: 'collab', label: 'PR SHARE', value: clamp(commits + prs ? prs / (commits + prs) : 0), raw: `${prs || 0} PRs` },
    { key: 'consistency', label: 'SPREAD', value: clamp(rangeDays ? activeDays / rangeDays : 0), raw: `${activeDays || 0}/${rangeDays || 0} days` },
  ]
  return dims
}

export const fmtMonth = monthName
