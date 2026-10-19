# Phase 1C-B0.5 — Pinned-Revision Ownership History Spike Results

**Status: PASS — every §10 architectural assumption validated empirically.**

Non-persisting, read-only spike run 2026-10-19 against the real Dev Ledger
GitHub App installation token (existing `contents:read` permission). No
Supabase client was initialized; nothing was written to any database; raw
output lives only in gitignored `.tmp/ownership-pinned-spike/results.json`.
Private repository data is anonymized (`PRIVATE_A`); no private paths,
logins, node IDs, commit messages, or commit SHAs appear in this document.

Runner: `scripts/spikes/ownership-pinned-history-spike.mjs`
Queries: `scripts/spikes/ownership/pinned-queries.mjs`

---

## Targets and auth

- Real GitHub App installation token via `getInstallationOctokit()` —
  identical to Phase 0.5. Installation inventory: 9 repositories.
- **Public target:** `facebook/react` — large public repo (tree ~7,900
  entries), chosen because every repository in the installation's current
  selection is private; also serves as the scale and HEAD-drift probe.
- **Private target:** `PRIVATE_A` — an installation repository (tree
  ~1,300 entries). Name, paths, logins, and SHAs withheld.
- Cross-repo probes used both targets' HEAD oids against the other repo.

## Exact query shapes

The production-intended pinned walk (executed verbatim, one GraphQL
request per page):

```graphql
query ($owner: String!, $name: String!, $oid: GitObjectID!,
       $path: String, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      __typename
      ... on Commit {
        oid
        history(first: 100, path: $path, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { oid committedDate author { user { id login } } }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
```

Pinned-object lookup (HEAD probe + tree OID):

```graphql
repository(owner: $owner, name: $name) {
  object(oid: $oid) {
    __typename
    oid
    ... on Commit { committedDate tree { oid } }
  }
}
```

HEAD control walk used `defaultBranchRef.target { ... on Commit {
history(...) } }` with the identical node shape.

## Results per architectural assumption

### 1. `Repository.object(oid:) → Commit` resolves — PASS

On both targets, `object(oid: <HEAD sha>)` returned
`__typename: "Commit"`, `oid` equal to the input SHA, and `tree.oid`.
A commit on a **non-default branch** (unreachable from default HEAD)
also resolved on both repos and anchored a history walk whose first node
was that commit — `object(oid:)` is an object-database lookup, not a
ref lookup.

### 2. Pinned `history(...)` repo-wide and path-scoped — PASS

- Repo-wide: 3 pages × 100 nodes on both targets; every page's resolved
  `object.oid` equaled the pinned SHA (per-request anchor check).
- Path-scoped: `history(path: <top-level dir from the pinned tree>)`
  returned correctly filtered results on both targets (react: 1 node for
  the sampled directory; PRIVATE_A: 2 nodes), each anchored to the pin.

### 3. Multi-page cursor stability across separate requests — PASS

- Pages fetched with one HTTP request each; `endCursor` from page *n*
  reused in a fresh request for page *n+1* with `object(oid:)` re-resolved
  every time — 0 duplicate oids across 300-node walks on both targets.
- Determinism: a later request re-fetching page 1 produced a byte-identical
  oid sequence; re-fetching page 2 with the stored `endCursor` produced a
  byte-identical oid sequence. Cursors survive across invocations anchored
  to the same pinned SHA.

### 4. HEAD movement / revision isolation — PASS (constructed proof)

- Pin `S` = the 100th node of the HEAD walk (~100 commits behind HEAD).
  Pinned walk at `S` returned `S` as its first node on both targets.
- Of the 99 commits newer than `S` present in HEAD page 1, **zero**
  appeared anywhere in `S`'s 200-node pinned walk — the walk is anchored
  to `S`, not to "whatever HEAD is now".
- Live-drift observation window: HEAD oid identical at start and end of
  the run on both targets (no organic push observed; a force-push cannot
  be manufactured read-only — see limitations).

### 5. Unreachable / deleted / foreign object behavior — PASS (characterized)

| Probe | Result |
|---|---|
| Well-formed nonexistent oid (`00…0`, `aa…a`) | `object: null`, no GraphQL error, cost 1 |
| Foreign-repo commit oid (react HEAD inside PRIVATE_A and vice versa) | `object: null`, no error |
| Closed/merged PR head oids (source branches may be deleted) — 3 sampled | all resolve `__typename: Commit` |
| Blob oid, tree oid via `object(oid:)` | resolve as `__typename: Blob` / `Tree`; `... on Commit` fields absent — **not** an error |

**Implementation consequence:** a missing/expired object yields `object:
null`, not `NOT_FOUND`, and a non-Commit oid yields a typed non-Commit
object rather than an error. The ownership worker must (a) treat
`object == null` as the fail-closed terminal error the design already
specifies, and (b) guard on `__typename == "Commit"` (or equivalently on
`history` being present) so a malformed pin can never silently degrade
to an empty walk.

### 6–7. Public and private repos — PASS both

Identical behavior and identical query shape on `facebook/react`
(public, ~7.9k tree entries, long history) and `PRIVATE_A` (private,
installation-scoped, ~1.3k tree entries). No permission expansion was
needed — the existing `contents:read` installation permission sufficed
for both, including `object(oid:)`, `history(path:)`, `refs`,
`pullRequests`, and the REST tree calls.

### 8. Pinned tree OID → REST recursive tree — PASS

- `object(oid:) → tree { oid }` on the pinned commit returned a tree SHA
  **equal** to REST `repos.getCommit(head).commit.tree.sha` on both
  targets — the GraphQL and REST object identities agree.
- `GET /git/trees/{pinned_tree_sha}?recursive=1` succeeded on both
  targets: react 7,901 entries, PRIVATE_A 1,304 entries,
  `truncated: false` in both; entry sets identical to the HEAD tree
  (expected — pin == HEAD in this measurement).

### 9. `author.user` under a pinned commit — PASS

- `author { user { id login } }` returned the required shape on all
  sampled nodes: **600/600 commits linked, 0 nulls** across both targets.
- Git objects (commit oid, date) are pinned; the `user` object is
  GitHub-side and resolved at query time — consistent with the design's
  assumption that `author.user` linkage is dynamic while the revision
  stays fixed. Renamed/re-linked accounts therefore resolve to current
  identities within a build; `author.user == null` remains possible in
  the wild and is already handled (unlinked synthetic bucket).
- No contributor identity was persisted; raw samples stayed in `.tmp`.

### 10. GraphQL cost — PASS

- **Every measured request cost exactly 1 point**: probe, `object(oid:)`
  lookup, 100-node repo-wide `history` pages, `history(path:)` pages,
  `refs`, `pullRequests`, cursor-refetches — cost was flat 1 regardless of
  node count or repo size on both targets.
- `rateLimit.remaining` decremented by exactly `cost` each request
  (installation pool observed decrementing 9,9xx → 9,9xx across 52 total
  requests including REST calls).
- History page latency: ~0.5–1.5 s (react pages ~1.0–1.4 s); lookup
  ~0.4 s. No secondary-rate-limit or throttling observed at 350 ms pacing.

## Limitations

- **True force-push unreachable-commit behavior was not manufacturable
  read-only.** What was measured: nonexistent/foreign oids → `object:
null`; deleted-source-branch PR head commits → still resolvable (GitHub
  retains PR objects); non-default-branch commits → resolvable. The
  unmeasured residue — a commit garbage-collected after force-push —
  can only resolve to `null` or an error, and both paths are already
  fail-closed in the design. This is characterization, not a blocker.
- No `author.user == null` case occurred in the 600-node sample; the
  unlinked path is design-tolerated but unobserved here.
- `hasNextPage` remained `true` past 300 nodes on both targets; walks
  were not run to history end (not needed for the assumptions).
- REST recursive-tree truncation was not observed (max 7,901 entries);
  repos with >100k entries remain covered by the Phase 0.5 fallback
  discussion.

## Verdict against `ownership-checkpoint-architecture.md` §10

| §10 requirement | Verdict |
|---|---|
| `object(oid:) → Commit → history(path:)` exact shape | **PASS** — works verbatim |
| Multi-page cursor stability, same pinned oid re-resolved per request | **PASS** — 0 dupes, deterministic refetch |
| Public **and** private repos | **PASS** |
| Unreachable-oid behavior characterized | **PASS** — `object: null`, not `NOT_FOUND`; non-Commit oids need `__typename` guard |
| Force-push/deleted-ref | **PASS w/ caveat** — PR-head commits persist; hard-GC case unmeasurable read-only, already fail-closed |
| `tree.oid` from pinned Commit + REST recursive tree | **PASS** — sha identity + entry-set equality proven |
| `author.user` resolution under pinned commit | **PASS** — dynamic GitHub-side resolution, git objects pinned |
| GraphQL cost | **PASS** — flat 1 pt/request incl. 100-node pages |

**PASS — B0.5 gate cleared.** The pinned-revision architecture in §10 is
empirically supported; migration 013 implementation may begin (under
separate approval — not initiated by this spike).
