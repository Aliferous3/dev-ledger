// Contributor identity classification for ownership ingestion — pure.
//
// Contract (spec §5, §6):
//  - linked contributor durable identity is the GitHub GraphQL User.id
//    (author.user.id); login is display-only and must never be a join key.
//  - email, author/committer names, and numeric databaseId are never
//    requested, derived, or stored.
//  - author.user == null → ONE unresolved 'unlinked' bucket per repository.
//    It is unresolved attribution, NOT a person — never pseudonymized by
//    name or email.
//  - 'other' is the synthetic aggregate of overflow LINKED contributors.
//  - bots are linked identities flagged is_bot; they are not people for
//    human-only metric purposes (§6.5).

import { createHash } from 'node:crypto'

export const UNLINKED_KEY = 'unlinked'
export const OTHER_KEY = 'other'

const CONTRIBUTOR_DOMAIN = 'devledger-ownership-contributor-v1'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// Repository-scoped opaque contributor key. Deterministic across processes,
// stable under login renames (keyed on the node id only), and scoped by the
// repository boundary so the same GitHub account never shares a key across
// repositories. Logins/emails/names never enter the hash.
export function contributorKey(repositoryId, githubNodeId) {
  if (typeof repositoryId !== 'string' || repositoryId === '') {
    throw new TypeError('contributorKey requires a repository id')
  }
  if (typeof githubNodeId !== 'string' || githubNodeId === '') {
    throw new TypeError('contributorKey requires a GitHub node id')
  }
  return sha256(`${CONTRIBUTOR_DOMAIN}\0${repositoryId}\0${githubNodeId}`)
}

// Conservative bot heuristic on the login only: GitHub App/bot accounts use
// the conventional '[bot]' login suffix (dependabot[bot], github-actions[bot]
// …). No broader username guessing — a login merely containing "bot" is not
// classified as a bot.
export function isBotLogin(login) {
  return typeof login === 'string' && /\[bot\]$/i.test(login.trim())
}

// Synthetic bucket shapes — fixed fields, never carry GitHub identity.
export function unlinkedContributor() {
  return {
    identity_kind: 'unlinked',
    contributor_key: UNLINKED_KEY,
    github_node_id: null,
    display_login: null,
    is_bot: false,
  }
}

export function otherContributor() {
  return {
    identity_kind: 'aggregate',
    contributor_key: OTHER_KEY,
    github_node_id: null,
    display_login: null,
    is_bot: false,
  }
}

// Classify one history/blame node's author.user into a contributor identity.
//   authorUser = { id, login } | null | undefined
// Linked rows carry the durable identity pair; missing/ malformed linked
// input collapses to the unlinked bucket rather than fabricating identity.
export function classifyAuthorIdentity(authorUser, repositoryId) {
  if (authorUser == null) return unlinkedContributor()
  const { id, login } = authorUser
  if (typeof id !== 'string' || id === '' || typeof login !== 'string' || login === '') {
    return unlinkedContributor()
  }
  return {
    identity_kind: 'linked',
    contributor_key: contributorKey(repositoryId, id),
    github_node_id: id,
    display_login: login,
    is_bot: isBotLogin(login),
  }
}

// Human-only metric basis (§6.3, §6.5): concentration/count inputs include
// only linked non-bot identities — unlinked, aggregate, and bots are never
// people for these metrics.
export function isHumanMetricBasis(identity) {
  return identity.identity_kind === 'linked' && identity.is_bot === false
}
