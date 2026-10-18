// Pure monthly history reducer for ownership ingestion.
//
// Turns a scope's in-memory metadata-only history(path:) node stream into
// bounded candidate aggregates matching the ownership_snapshots contract
// (spec §4.3, §6, §11). NO persistence: no Supabase, no Octokit, no fs, no
// logging — the persistence/resumability tranche owns writes.
//
// Semantics (§16 spec / instruction):
//  - each node = ONE commit touching the scope; touch share is a
//    maintenance-activity signal, never code volume or expertise.
//  - human metrics are computed over the FULL transient contributor set
//    BEFORE Top-25 folding; basis = linked && !is_bot only.
//  - the unlinked bucket always gets its own row, is never folded into
//    'other', and never counts as a person.
//  - 'other' = excess LINKED contributors past the Top-25 cap — it is
//    "Other linked contributors", not "other humans"; UI must never label
//    it as people.
//  - durable contributor candidates exist only for identities individually
//    represented in at least one retained scope-period (§6.4 durable
//    identity minimization).

import {
  classifyAuthorIdentity,
  isHumanMetricBasis,
  otherContributor,
  unlinkedContributor,
  OTHER_KEY,
  UNLINKED_KEY,
} from './contributors.mjs'

export const TOP_LINKED_PER_PERIOD = 25

// First instant of the UTC calendar month — never local time.
export function monthStartUtc(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new TypeError('unparseable committedDate')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

// Deterministic 4-decimal share for numeric(5,4) columns. Clamped to [0,1];
// never NaN/Infinity/-0. Scope totals stay the authoritative denominator —
// shares are NOT force-summed by mutating any one contributor's result.
export function shareOf(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  let s = Math.round((part / total) * 10000) / 10000
  if (s < 0) s = 0
  if (s > 1) s = 1
  return s === 0 ? 0 : s // normalize -0
}

// Deterministic rank for the Top-N fold: touch_commits descending, then the
// opaque contributor key ascending as a stable tie-break.
function compareByTouches(a, b) {
  if (b.touches !== a.touches) return b.touches - a.touches
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

// nodes: [{ committedDate, author: { user: { id, login } | null } }]
// scope:  a scope candidate identity (passed through for labeling only)
// Returns { scope, months, contributor_candidates } — candidate shapes only;
// nothing here is or may be written to the database in this tranche.
export function reduceHistoryToMonthly({ repositoryId, scope, nodes }) {
  const byMonth = new Map()
  // contributor_key -> identity + first/last seen (for durable candidates)
  const seen = new Map()

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || node.committedDate == null) {
      throw new TypeError('history node missing committedDate')
    }
    const period = monthStartUtc(node.committedDate)
    const identity = classifyAuthorIdentity(node.author?.user, repositoryId)

    let month = byMonth.get(period)
    if (!month) {
      month = { total: 0, unlinked: 0, linked: new Map(), humanKeys: new Set() }
      byMonth.set(period, month)
    }
    month.total += 1

    if (identity.identity_kind === 'unlinked') {
      month.unlinked += 1
      continue
    }

    const cur = month.linked.get(identity.contributor_key) ?? { key: identity.contributor_key, touches: 0, is_bot: identity.is_bot }
    cur.touches += 1
    month.linked.set(identity.contributor_key, cur)
    if (isHumanMetricBasis(identity)) month.humanKeys.add(identity.contributor_key)

    // transient durable-candidate bookkeeping — only used when the identity
    // ends up individually represented in a retained period.
    const prev = seen.get(identity.contributor_key)
    seen.set(identity.contributor_key, {
      identity_kind: 'linked',
      contributor_key: identity.contributor_key,
      github_node_id: identity.github_node_id,
      display_login: identity.display_login,
      is_bot: identity.is_bot,
      first_seen_at: prev
        ? prev.first_seen_at < node.committedDate ? prev.first_seen_at : node.committedDate
        : node.committedDate,
      last_seen_at: prev
        ? prev.last_seen_at > node.committedDate ? prev.last_seen_at : node.committedDate
        : node.committedDate,
    })
  }

  const months = []
  const represented = new Set()

  for (const [period, m] of [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ranked = [...m.linked.values()].sort(compareByTouches)
    const top = ranked.slice(0, TOP_LINKED_PER_PERIOD)
    const overflow = ranked.slice(TOP_LINKED_PER_PERIOD)

    const contributors = top.map((c) => {
      represented.add(c.key)
      return {
        contributor_key: c.key,
        identity_kind: 'linked',
        is_bot: c.is_bot,
        touch_commits: c.touches,
        touch_share: shareOf(c.touches, m.total),
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
      const otherTouches = overflow.reduce((n, c) => n + c.touches, 0)
      contributors.push({
        contributor_key: OTHER_KEY,
        identity_kind: 'aggregate',
        is_bot: false,
        touch_commits: otherTouches,
        touch_share: shareOf(otherTouches, m.total),
      })
    }

    months.push({
      period_start: period,
      totals: {
        total_touch_commits: m.total,
        // computed from the full transient set BEFORE folding — never
        // capped by the Top-25 boundary.
        human_contributor_count: m.humanKeys.size,
        unlinked_touch_share: shareOf(m.unlinked, m.total),
      },
      contributors,
    })
  }

  // Durable identity minimization: a linked contributor becomes a durable
  // candidate ONLY if individually represented somewhere — overflow-only
  // identities stay transient and produce no identity row (§6.4). The two
  // synthetic buckets get durable rows when they appear.
  const contributor_candidates = []
  for (const key of represented) {
    if (key === UNLINKED_KEY) contributor_candidates.push(unlinkedContributor())
    else if (key === OTHER_KEY) contributor_candidates.push(otherContributor())
    else contributor_candidates.push(seen.get(key))
  }
  contributor_candidates.sort((a, b) => (a.contributor_key < b.contributor_key ? -1 : 1))

  return { scope, months, contributor_candidates }
}
