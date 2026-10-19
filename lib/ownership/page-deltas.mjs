// ACCUMULATE page delta reduction — pure, no I/O.
//
// Folds one pinned-history GraphQL page (≤100 nodes) into grouped counter
// deltas at (period_start × work_key) grain — exactly the shape
// own_checkpoint_page's p_deltas expects. Mathematically equivalent to
// reducing each node individually: touches sum, first/last_seen merge by
// min/max, and is_bot comes from the canonical classifier.
//
// HARD PRIVACY CONTRACT (§6.4 + §9 of the spec): the returned payload may
// contain ONLY {period_start, work_key, is_bot, touches, first_seen_at,
// last_seen_at}. github_node_id and display_login exist transiently in
// memory just long enough to derive the pseudonymous key — they must
// never appear in a returned delta, a log line, or a thrown value.
// Malformed provider identity raises OwnershipIdentityError and aborts
// the page: the checkpoint then never commits and the walk wedges at a
// durable cursor — the documented fail-closed path (§5.5).

import {
  classifyAuthorIdentity,
  OwnershipIdentityError,
  UNLINKED_KEY,
} from './contributors.mjs'
import { monthStartUtc } from './history-reducer.mjs'

// nodes: [{ committedDate, author: { user: { id, login } | null } | null }]
// repositoryId: the repository-uuid boundary the contributor keys are
//   scoped to (same id the canonical reducer receives).
export function reducePageDeltas(repositoryId, nodes) {
  const groups = new Map()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || node.committedDate == null) {
      throw new TypeError('history node missing committedDate')
    }
    const period = monthStartUtc(node.committedDate)
    if (node.author != null && typeof node.author !== 'object') {
      throw new OwnershipIdentityError()
    }
    // classifyAuthorIdentity returns the literal 'unlinked' bucket for
    // author.user == null, the 64-hex repository-scoped key otherwise,
    // and throws OwnershipIdentityError on malformed provider identity.
    const identity = classifyAuthorIdentity(node.author?.user, repositoryId)

    const groupKey = `${period}${identity.contributor_key}`
    let g = groups.get(groupKey)
    if (!g) {
      g = {
        period_start: period,
        work_key: identity.contributor_key,
        is_bot: identity.is_bot, // first classification wins — canonical rule
        touches: 0,
        first_seen_at: node.committedDate,
        last_seen_at: node.committedDate,
      }
      groups.set(groupKey, g)
    }
    g.touches += 1
    if (node.committedDate < g.first_seen_at) g.first_seen_at = node.committedDate
    if (node.committedDate > g.last_seen_at) g.last_seen_at = node.committedDate
  }

  // Deterministic output order: identical pages always serialize to the
  // identical payload — keeps checkpoints byte-stable and tests exact.
  return [...groups.values()].sort((a, b) =>
    a.period_start === b.period_start
      ? a.work_key < b.work_key ? -1 : a.work_key > b.work_key ? 1 : 0
      : a.period_start < b.period_start ? -1 : 1,
  )
}

// Exported for callers that need the exact domain the DB enforces —
// 'unlinked' plus 64-hex keys only; 'other' is never a counter key.
export { UNLINKED_KEY }
