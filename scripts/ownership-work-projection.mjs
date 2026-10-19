// Test-side projection of accumulated ownership_history_work rows into the
// canonical reduceHistoryToMonthly output shape — the pure comparison the
// checkpoint architecture's differential harness requires (§11: "Where an
// exact finalized result cannot yet exist because RESOLVE/COMMIT are
// intentionally later, a pure projection from work state ... compare it to
// the canonical reducer").
//
// TEST TOOLING ONLY — nothing here is production state. The fold is
// reimplemented deliberately: drift between this projection and the
// canonical reducer is exactly what the differential catches.
//
// rows: ownership_history_work rows {period_start, work_key, is_bot,
//   touch_commits, first_seen_at, last_seen_at}
// returns { months, represented, candidateBounds } where months matches
//   reduceHistoryToMonthly's month entries and represented is the
//   individually-represented linked-key union.

import { TOP_LINKED_PER_PERIOD, shareOf } from '../lib/ownership/history-reducer.mjs'
import { OTHER_KEY, UNLINKED_KEY } from '../lib/ownership/contributors.mjs'

const isHexKey = (s) => /^[0-9a-f]{64}$/.test(s)

// pg drivers return timestamptz columns as Date objects — normalize to ISO
// strings so periods group correctly and reducer comparisons are exact.
const iso = (v) => (v instanceof Date ? v.toISOString() : v)

export function projectWorkToMonthly(rows) {
  const byPeriod = new Map()
  const bounds = new Map() // work_key -> {first,last,is_bot}
  for (const r of rows) {
    const period = iso(r.period_start)
    const first = iso(r.first_seen_at)
    const last = iso(r.last_seen_at)
    let p = byPeriod.get(period)
    if (!p) {
      p = { total: 0, unlinked: 0, linked: [], human: new Set() }
      byPeriod.set(period, p)
    }
    p.total += r.touch_commits
    if (r.work_key === UNLINKED_KEY) {
      p.unlinked += r.touch_commits
      continue
    }
    p.linked.push({ ...r, period_start: period, first_seen_at: first, last_seen_at: last })
    if (!r.is_bot) p.human.add(r.work_key)
    const b = bounds.get(r.work_key)
    bounds.set(r.work_key, {
      is_bot: r.is_bot,
      first_seen_at: b ? (b.first_seen_at < first ? b.first_seen_at : first) : first,
      last_seen_at: b ? (b.last_seen_at > last ? b.last_seen_at : last) : last,
    })
  }

  const months = []
  const represented = new Set()
  for (const [period, m] of [...byPeriod.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ranked = [...m.linked].sort((a, b) =>
      b.touch_commits !== a.touch_commits
        ? b.touch_commits - a.touch_commits
        : a.work_key < b.work_key ? -1 : a.work_key > b.work_key ? 1 : 0)
    const top = ranked.slice(0, TOP_LINKED_PER_PERIOD)
    const overflow = ranked.slice(TOP_LINKED_PER_PERIOD)
    const contributors = top.map((c) => {
      represented.add(c.work_key)
      return {
        contributor_key: c.work_key,
        identity_kind: 'linked',
        is_bot: c.is_bot,
        touch_commits: c.touch_commits,
        touch_share: shareOf(c.touch_commits, m.total),
      }
    })
    if (m.unlinked > 0) {
      represented.add(UNLINKED_KEY)
      contributors.push({
        contributor_key: UNLINKED_KEY,
        identity_kind: 'unlinked',
        is_bot: false,
        touch_commits: m.unlinked,
        touch_share: shareOf(m.unlinked, m.total),
      })
    }
    if (overflow.length > 0) {
      represented.add(OTHER_KEY)
      const t = overflow.reduce((n, c) => n + c.touch_commits, 0)
      contributors.push({
        contributor_key: OTHER_KEY,
        identity_kind: 'aggregate',
        is_bot: false,
        touch_commits: t,
        touch_share: shareOf(t, m.total),
      })
    }
    months.push({
      period_start: period,
      totals: {
        total_touch_commits: m.total,
        human_contributor_count: m.human.size,
        unlinked_touch_share: shareOf(m.unlinked, m.total),
      },
      contributors,
    })
  }

  const candidateBounds = new Map(
    [...represented].filter(isHexKey).map((k) => [k, bounds.get(k)]),
  )
  return { months, represented, candidateBounds }
}
