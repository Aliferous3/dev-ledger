# Ownership Data & Privacy Contract — Production Specification

> **Status: schema foundation deployed; ingestion and UI not yet live.**
>
> This document is the authoritative implementation contract for the Code
> Ownership Over Time feature. It translates the approved architecture
> ([code-ownership-over-time-rfc.md](code-ownership-over-time-rfc.md)) and the
> measured evidence ([ownership-graphql-spike-results.md](ownership-graphql-spike-results.md))
> into an exact data contract that Phase 1B (schema + ingestion) and Phase 1C
> (dashboard) must implement and that review must enforce.
>
> **What is live today:** migration `012_ownership.sql` is applied in
> production — the four ownership tables exist with RLS/grants/composite-FK
> foundations, and the dormant `dash_ownership_*` SECURITY INVOKER RPCs are
> deployed. All four tables hold **zero rows**.
>
> **What is NOT live:** no ownership ingestion runs; no ownership data is
> collected or written; `OWNERSHIP_INGEST_ENABLED` is not enabled anywhere;
> no ownership UI exists; the public trust record
> (`src/security/SecurityPrivacyPage.tsx`) has NOT been amended — it changes
> only in the release train where collection actually begins (§17). Where
> the text describes ownership behavior it describes *future behavior once
> ownership ships*. Current production behavior is described in §2 and cited
> against real files.

Companion documents:

- RFC: `docs/code-ownership-over-time-rfc.md` (merged `6554529694f7cd1ec963195654f24a10daaa6ad9`)
- Spike results: `docs/ownership-graphql-spike-results.md` (merged via PR #74, `252d75360a72ccd7cc164295f375a04bc05599b4`)
- Live trust record: `src/security/SecurityPrivacyPage.tsx`
- Recovery policy: `docs/disaster-recovery.md`

---

## 1. Executive decision

**Recommended production privacy model:**

Dev Ledger may persist **derived, bounded, multi-contributor ownership
metadata** — monthly contribution/maintenance aggregates and current
surviving-line attribution — scoped to repositories the signed-in user's
GitHub App installation is authorized to read.

It must continue to never persist:

- source code, source lines, or any file content
- patches or diffs
- commit messages
- pull-request titles
- GitHub email addresses (author or committer)
- OAuth tokens, installation tokens, GitHub App private keys
- raw webhook payload bodies
- raw GraphQL responses, raw blame ranges, raw `history(path:)` nodes
- per-commit all-contributor history rows

**Why this is the minimum new data category:** the feature's honest outputs —
"who maintains this area," "how concentrated is knowledge," "who last touched
it" — are *aggregates over other people's commit metadata*. Today's schema
physically cannot answer them: every stored commit row belongs to the
signed-in user by construction (`lib/analytics.mjs` `isAttributedCommit`,
`migrations/011` dropping `author_user_id`/`author_login`). There is no way to
compute knowledge distribution from single-author rows. The smallest possible
expansion is therefore **aggregates of other contributors' activity**, not
their activity itself. Anything finer-grained than a
(scope × contributor × month) row is prohibited.

This is the one deliberate amendment to the standing invariant "other people's
contributions are never persisted" — it becomes "other people's contributions
are never persisted *as records*; bounded derived aggregates about them may
be." Every other invariant in `AGENTS.md` is unchanged.

---

## 2. Verified current behavior (audit of `origin/main`)

Audited at merge `252d75360a72ccd7cc164295f375a04bc05599b4`. Claims below cite
the code as it exists today.

### 2.1 What is persisted today

| Data | Storage | Source |
|---|---|---|
| User identity (`github_user_id`, `github_login`, `github_node_id`, avatar, display name) | `users` | `migrations/001_initial.sql:1-10` |
| Installation link | `github_installations` | `migrations/001:12-22` |
| Repo metadata (owner/name/full_name, private, language, archived, fork, pushed_at, installation_id, `disconnected_at`, `disconnect_source`) | `repositories` | `migrations/001:24-39`, `migrations/002:6-7`, `migrations/007:198-203` |
| Language byte shares | `repository_languages` | `migrations/001:41-46` |
| Per-commit rows **of the signed-in user only**: sha, committed_at, additions, deletions | `commits` | `migrations/001:48-61` as minimized by `migrations/011:31-36` |
| Per-PR rows **of the signed-in user only**: pr id, state, created/merged | `pull_requests` | `migrations/001:63-76` as minimized by `migrations/011:38-42` |
| Coverage windows | `repo_coverage` | `migrations/004` |
| Resumable sync state (phase, `cursor` jsonb, last_commit_at, closed-taxonomy `error`) | `repo_sync`, `user_sync` | `migrations/002:15-43` |
| Session records | `auth_sessions` | `migrations/007:160-174` |
| Webhook dedup (delivery id + event only) | `webhook_deliveries` | `migrations/007:182-192` |
| Security telemetry (fixed fields, HMAC hashes, no IP/UA/body) | `security_events` | `migrations/009`, `lib/security-events.mjs` |
| Feedback submissions | `feedback` | `migrations/010` |

### 2.2 The attribution boundary (the thing ownership changes)

- `HISTORY_QUERY` in `lib/sync.mjs:23-43` requests commits with
  `author: { id: $author }` — GitHub pre-filters to the user's node id.
- `isAttributedCommit` (`lib/analytics.mjs:50-52`) double-checks
  `author.user.id === user.github_node_id` before any row is written
  (`lib/sync.mjs:671`, `738`).
- `migrations/011` removed `commits.author_user_id`, `author_login`,
  `authored_at`, `files_changed`, `is_merge` and the PR author columns —
  author identity is verified transiently and deliberately not persisted.
- PR ingest filters `item.user?.id !== user.github_user_id`
  (`lib/sync.mjs:821`, webhook `api/webhooks/github.mjs:219`).

**Consequence:** other contributors' data currently never survives a sync
slice. Ownership is the first feature that must *not* apply this filter.

### 2.3 Sync/resume machinery (reusable, do not rebuild)

- Bounded slices: `runSync(userId, { budgetMs })` — 20s API-driven, 45s
  webhook/cron (`lib/sync.mjs:172`, `api/webhooks/github.mjs:118`).
- Takeover lock: `acquireSyncLock` CAS on `user_sync.locked_at`,
  `LOCK_STALE_MS = 90_000` (`lib/sync.mjs:56-75`).
- Cursor persistence: `repo_sync.cursor` jsonb `{ endCursor, since }`
  (`lib/sync.mjs:706`).
- Rate-limit pause: `RateLimitError` → `status='rate_limited'` +
  `resume_at` (`lib/sync.mjs:464-465`, `lib/github.mjs:28-44`).
- Error taxonomy: `repo_sync.error`/`user_sync.error` carry only closed codes
  (`lib/sync-errors.mjs`, `migrations/011:47-66`).
- Continuation: `push`/`pull_request` webhooks kick `scheduleSync`; daily
  cron continues unfinished runs (`api/webhooks/github.mjs:116-122`,
  `api/cron/sync.mjs`).

### 2.4 Database security model (real, audited)

- **RLS enabled on every application table, zero policies** — a closed second
  barrier (`migrations/007:26-34`, security page §06).
- **Browser roles hold nothing:** explicit `revoke all ... from public, anon,
  authenticated` + default-privilege revokes so future tables inherit nothing
  (`migrations/007:41-53`).
- **The only data path is `service_role`** via `lib/db.mjs`; `003` grants
  DML to `service_role` and sets default privileges for future tables.
- Dashboard reads run as **`SECURITY INVOKER` functions** with `EXECUTE`
  granted to `service_role` only (`migrations/007:62-117`); views are pinned
  `security_invoker` (`migrations/007:123-152`).
- The API scopes every query by the internal `user_id` from the validated
  session (`api/dashboard.mjs:26-38`, `lib/require-user.mjs`).

### 2.5 Deletion/disconnect semantics (real, audited)

`api/user.mjs` POST `mode`:

- `keep` — `disconnected_at=now`, `disconnect_source='user'`: history kept,
  ingestion stops (`api/user.mjs:98-106`).
- `resume` — clears both fields (`api/user.mjs:108-116`).
- `delete` — explicit deletes for `pull_requests`, `commits`, `repo_coverage`,
  `repo_sync`, `repository_languages`, then `repositories`
  (`api/user.mjs:119-124`). (Commits/PRs use `on delete set null` FKs, hence
  explicit deletes rather than cascade.)
- `DELETE /api/user?confirm=1` — `revokeAllSessions` then `users` row delete;
  cascades everything (`api/user.mjs:36-58`).

GitHub-side removal (`installation` deleted / `installation_repositories`
removed) → `disconnected_at`, `disconnect_source='github'`, history retained
(`api/webhooks/github.mjs:124-140`, `160-180`). Re-grant auto-reconnects
`github`-source disconnects (`lib/sync.mjs:292-303`).

### 2.6 Backup/recovery (real, audited)

- Backups are **allowlist-scoped data-only dumps**: `pg_dump
  --table=public.<name>` over exactly `BACKUP_TABLES` in
  `scripts/backup-scope.mjs:45`. New unclassified tables **fail CI** —
  classification is mandatory, not optional.
- Ephemeral exclusions: `auth_sessions`, `webhook_deliveries`,
  `security_events`, `schema_migrations`.
- Retention: 7 daily + 4 weekly + pre-migration dumps
  (`docs/disaster-recovery.md:97-106`).
- Restore replays migrations first (schema never in dump), then
  `pg_restore --data-only` under active FKs (`docs/disaster-recovery.md:40-58`).

### 2.7 Telemetry (real, audited)

- `security_events`: fixed-field records, `EVENT_SPEC` taxonomy, HMAC
  correlation hashes, no IP/UA/body/tokens, 30-day retention
  (`lib/security-events.mjs:40-110`).
- Product analytics: PostHog EU, allowlisted custom events via first-party
  proxy, no `identify()`, no autocapture/replay (security page §09,
  `test/posthog-analytics.test.mjs`).
- GA4: sanitized public-site page views only.

### 2.8 Public trust record (real, audited)

`src/security/SecurityPrivacyPage.tsx` — its header comment declares it a
**source-of-truth contract** that must be updated when schema/deletion
behavior changes. Relevant current claims ownership will amend:

- §01 COMMITS: "only for commits GitHub attributes to your account … never
  persisted" (line 153)
- §03 AUTHOR IDENTIFIERS: "other people's contributions are never persisted"
  (line 189)
- §03 SOURCE CODE (186), COMMIT MESSAGES (187), PR TITLES (188), EMAIL (191)
  — all remain true under ownership and must not regress.

---

## 3. Data classification

| # | Category | Examples | Persisted? | Retention | Deletion | Browser? | Private-repo notes | Sensitivity |
|---|---|---|---|---|---|---|---|---|
| A | Existing user/account data | §2.1 rows | yes (existing) | while account lives | cascades on account delete | via scoped API | repo names incl. private already shown to owner | low-medium |
| B | Existing repository metadata | §2.1 | yes | while retained | keep/delete semantics §2.5 | via scoped API | private `full_name` already persisted | medium |
| **C** | **New ownership derived data** | §4 | yes (future) | while repo retained | cascades §14 | via scoped dashboard API only | same boundary as B | **medium-high — third-party identity** |
| D | Transient GitHub processing data | §9 | **never** | dies with invocation | n/a | never | same | high if leaked |
| **E** | **Prohibited data** | §5 | **never** | — | — | never | — | critical |

Nothing may move from D or E into C without amending this document.

---

## 4. New ownership data — allowed fields

Every field below passed the test *"if removed, does the product still work?"*
Fields that failed are listed at the end as **rejected**.

### 4.1 Scope definition (`ownership_scopes`)

| Field | Type | Why required |
|---|---|---|
| `id` | uuid pk | row identity |
| `user_id` | uuid → users, cascade | tenant isolation (denormalized for direct scoping) |
| `repository_id` | uuid → repositories, cascade | repo boundary + delete cascade |
| `scope_path_hash` | text | deterministic lookup/index key for the current normalized path (§8 — not rename-stable) |
| `display_path` | text, null for repo scope | UI label after disconnect — see §8 decision |
| `scope_type` | text: `repo` \| `dir` | repo row carries no path |
| `depth` | int | bounded enumeration (≤4 per RFC §18) |
| `excluded` | boolean + `exclusion_reason` text null | **only** for legitimately persisted scopes later omitted by cardinality/analysis limits (`'cardinality_cap'`), so UI can say "not analyzed" — never for vendor/generated/binary/submodule paths, which are excluded in memory and never persisted at all (§8) |
| `created_at`, `updated_at` | timestamptz | housekeeping |

**Rejected:** `file` scope type (no file-level UI in V1 — RFC §18);
per-scope GitHub object ids (tree SHAs not needed once enumeration is a
cursor — rejected to keep Git internals out of storage, except `last_sha`
in sync state §4.4 where it is a resume anchor); persisting
vendor/generated/binary/submodule paths even as tombstones — they are
filtered in memory during enumeration and never reach this table (§8).

### 4.2 Contributor identity (`ownership_contributors`)

| Field | Type | Why required |
|---|---|---|
| `id` | uuid pk | row identity |
| `user_id`, `repository_id` | uuid FKs, cascade | tenant + repo scope — **identity is repository-scoped by design (§6)** |
| `contributor_key` | text | opaque per-repo stable key (§5); unique per repo |
| `identity_kind` | text: `linked` \| `unlinked` \| `aggregate` | disjoint classes — `aggregate` marks synthetic buckets such as `other` (§6.4) |
| `github_node_id` | text null | durable key for linked accounts only — the GraphQL `User.id` already selected as `author.user.id` (the same value `isAttributedCommit` compares against `users.github_node_id`) |
| `display_login` | text null | current GitHub login for display — see §6 decision |
| `is_bot` | boolean | bots excludable in UI per RFC §10.3 |
| `first_seen_at`, `last_seen_at` | timestamptz | powers "recent maintainer" without scanning snapshots |
| `created_at`, `updated_at` | timestamptz | housekeeping |

**Rejected:** global contributor table; numeric `databaseId` (no concrete
product requirement — the GraphQL node id already returned by the
attribution path is the durable key; the codebase already distinguishes
`users.github_user_id bigint` from `users.github_node_id text` and
`author.user.id` is the latter); avatar URLs (not needed for the
metrics, one less PII field); name/email-derived keys for unlinked rows
(§6.3 — prohibited); `login_history` (renames self-heal via refresh).

### 4.3 Aggregates (`ownership_snapshots`)

One table, two row shapes. **Monthly rows are immutable period facts**;
current-state and mutable-window metrics live only on `head` rows so a
historical row, once written, never changes meaning.

**Common columns (all rows):**

| Field | Type | Why required |
|---|---|---|
| `id` | uuid pk | |
| `user_id`, `repository_id` | uuid FKs | direct tenant scoping |
| `scope_id` | uuid → ownership_scopes, cascade | |
| `contributor_id` | uuid → ownership_contributors, cascade, **null = scope-total row** | per-contributor vs scope summary |
| `period_granularity` | text: `month` \| `head` | `head` = current-state snapshot (HEAD blame + recent-window signals) |
| `period_start` | timestamptz | month start; fixed sentinel `1970-01-01` for `head` rows |
| `calculation_version` | int | §13 versioning — **part of row identity** |
| `created_at`, `updated_at` | timestamptz | |

**Contributor rows (`contributor_id` not null) by granularity:**

| Granularity | Fields carried | Semantics |
|---|---|---|
| `month` | `touch_commits` int, `touch_share` numeric(5,4) | immutable: contributor's path touches and share that month |
| `head` | `surviving_lines` bigint, `surviving_line_share` numeric(5,4), `recent_touch_commits` int, `first_meaningful_touch` timestamptz null, `last_meaningful_touch` timestamptz null | current-state: rewritten wholesale each HEAD pass |

**Scope-total rows (`contributor_id` null) by granularity:**

| Granularity | Fields carried | Semantics |
|---|---|---|
| `month` | `total_touch_commits` int, `human_contributor_count` int, `unlinked_touch_share` numeric(5,4) | immutable period denominators |
| `head` | `human_contributor_count` int, `recent_human_maintainer_count` int, `top_human_contributor_share` numeric(5,4), `total_surviving_lines` bigint, `unlinked_surviving_line_share` numeric(5,4) | current-state concentration inputs — human-only basis: `linked` ∧ `!is_bot` (§6.3, §6.5) |

Unique: `(scope_id, contributor_id, period_granularity, period_start,
calculation_version)` — **`calculation_version` is part of row identity** so
version N and N+1 rows coexist during rebuilds (§13). With `contributor_id`
nullable, scope-total uniqueness needs a separate partial unique index
`where contributor_id is null` over `(scope_id, period_granularity,
period_start, calculation_version)`. Implementation detail for Phase 1B.

**Rejected:** `commit_shas` arrays (raw commit linkage — prohibited category);
`lines_added`/`lines_deleted` per scope (whole-commit stats are *not*
path-scoped — measured spike finding; would be a false metric);
`review_count`/PR-based signals (V1 is commit+blame only);
`confidence_score` (V1 presents raw signals, no derived verdict per RFC §17);
`period_end` (derivable from granularity).

### 4.4 Resumability (`ownership_sync_state`)

| Field | Type | Why required |
|---|---|---|
| `user_id`, `repository_id` | uuid, unique pair | mirrors `repo_sync` |
| `phase` | text: `pending` \| `history` \| `blame` \| `done` \| `error` | bounded-slice resumption |
| `history_cursor` | jsonb: `{ scope_id: endCursor }` | per-dir `history(path:)` page cursors |
| `blame_cursor` | jsonb: `{ next_scope, next_file_index, tree_sha }` | resume mid-blame pass; `tree_sha` detects tree drift between slices |
| `pending_scopes` | uuid[] or jsonb | scopes whose aggregates are incomplete |
| `active_version` | int null | the `calculation_version` the dashboard currently serves; **null until the first build completes** (§13) |
| `building_version` | int null | the version under construction; null when no build is in progress (§13) |
| `last_processed_sha` | text null | HEAD boundary anchor for incremental runs — the *only* sha allowed |
| `last_processed_at` | timestamptz | `pushed_at ≤ last_processed_at` incremental skip |
| `error` | text — **closed taxonomy only** | same `lib/sync-errors.mjs` discipline; new codes added to the enum, never provider text |

Cursors carry GraphQL cursors and file indexes — never raw nodes, ranges,
paths, or emails.

---

## 5. Prohibited persistence contract

The ownership implementation must **never** persist, in any table, log, or
error field:

1. Source text, source lines, source snippets — in any encoding.
2. `Blob.text`, blob contents, byteSize-for-content purposes.
3. Patches, diffs, `files[].patch`, archive bits, clone worktrees.
4. Raw GraphQL responses, raw blame ranges (`startingLine`/`endingLine`
   per-commit), raw `history(path:)` nodes.
5. Commit messages (`message`, `messageHeadline`, `messageBody`).
6. Pull-request titles.
7. Author or committer **email addresses** — the `email` field is never
   *selected*, which is stronger than select-and-discard (RFC §10.2).
8. Raw git author names for unlinked identities **as stored identity** —
   see §6.3; a name is usable transiently only as a grouping hint inside a
   slice if ever needed, and V1 does not need it at all.
9. OAuth tokens, installation tokens, GitHub App private keys.
10. Raw webhook payload bodies.
11. Per-commit all-contributor rows — the multi-contributor commit stream is
    reduced to monthly aggregates **inside the slice** and discarded.
12. Commit SHAs **except** `last_processed_sha` in §4.4 (resume anchor) —
    no per-scope, per-contributor, or per-period sha lists.
13. Error text beyond the closed `lib/sync-errors.mjs` taxonomy.
14. Private paths, logins, or repo names in `security_events`, logs, error
    fields, or analytics (§7, §19).

**Anti-creep rule:** V1 ingests a multi-contributor stream to produce
aggregates. Any PR that makes the *stored model* finer-grained than
(scope × contributor × month) — e.g., persisting the walk stream "for
debugging" — violates this contract and the §23 tests must catch it.

---

## 6. Contributor identity contract

### 6.1 Linked contributors — **decision: store `github_node_id` + current `display_login`**

- `github_node_id` — the GraphQL `User.id` value already selected as
  `author.user.id` and compared by `isAttributedCommit` against
  `users.github_node_id` — is the durable key. Logins are mutable and must
  never be the join key. The numeric `databaseId` is deliberately **not**
  requested: no product requirement exists for it, and the node id already
  serves the identity role.
- `display_login` is persisted because the UI must render a name after
  disconnect (retain-history is a real product mode — §2.5); id-only rows
  would make every retained repo's ownership view unreadable. Login is
  refreshed on every recalculation, self-healing renames.
- This is the same PII class already stored for `owner_login`/`full_name` on
  `repositories` — the increment is *quantity* (all contributors, not just
  the owner), not *kind*.

### 6.2 Answered policy questions

- Are linked logins PII? **Yes** — they resolve to public GitHub identities.
  They are treated as such: never in telemetry, never cross-tenant, deleted
  on repo/account deletion.
- Could node ids alone suffice? No — unreadable UI after disconnect.
- Searchable across users? **No.** No global index, no cross-tenant lookup
  function, no "find user X's other repos" capability is to exist.
- Can two tenants' rows about the same GitHub contributor be joined? The
  data carries the same `github_node_id` value, but **no read or write path
  may join or enumerate across `user_id`** — prevention rests on
  authenticated API scoping plus explicit `user_id` constraints on every
  path, verified by the behavioral tests in §23. This is a hard rule, not a
  convenience.
- Global contributor profiles? **Explicitly never.** There is no
  contributor-keyed table above the repository row.

### 6.3 Unlinked contributors — **decision: ONE "Unlinked contributor" bucket per repository**

All `author.user == null` attribution aggregates into a single
`identity_kind='unlinked'` contributor row per repository
(`contributor_key='unlinked'`, `github_node_id`/`display_login` null → UI
label "Unlinked contributor").

**This bucket is unresolved attribution, not a person.** It may represent
many real individuals and is explicitly not one contributor. Therefore:

- it must **not** count as exactly one known contributor;
- it must **not** be eligible for top-contributor/concentration position;
- it must **not** count as one recent maintainer;
- it must **not** lower `human_contributor_count` by folding real
  people into a single name;
- its touch share and surviving-line share are stored/displayed **as their
  own unresolved-attribution figures** (`unlinked_touch_share`,
  `unlinked_surviving_line_share` on scope-total rows), separate from the
  per-contributor metrics;
- concentration metrics (`human_contributor_count`,
  `recent_human_maintainer_count`, `top_human_contributor_share`) operate
  **only over `linked` contributors with `is_bot = false`** (§6.5) and
  must be qualified in UI/methodology as covering attributable human
  attribution only, whenever the unresolved share is material.

Justification for the single bucket (over pseudonymous subdivision):

- The spike measured unlinked as **common, not rare** — 28.4% of blame
  ranges / 18.6% of surviving lines on one mature public-repo sample. A
  first-class honesty display, not an edge case.
- Pseudonymous name-bucketing implies identity resolution Dev Ledger cannot
  honestly provide (two people share names; one person uses several) — it
  would *manufacture* false precision.
- Email is prohibited entirely, so no better grouping signal exists.
- If measured UX feedback ever demands subdivision, it requires a spec
  amendment and methodology copy that calls it approximate. V1 does not
  subdivide.

### 6.4 Synthetic `aggregate` buckets ("other") + identity minimization

The top-25-per-scope-period cap (§11) folds surplus contributors into an
`other` row: `identity_kind='aggregate'`, `contributor_key='other'`,
`github_node_id`/`display_login` always null.

Rules:

- `aggregate` rows are **never treated as people** — excluded from
  `human_contributor_count`, `recent_human_maintainer_count`, and
  top-contributor position exactly like `unlinked`.
- `unlinked` is **never folded into `other`** — unresolved attribution stays
  visibly unresolved; `other` only ever contains excess *linked*
  contributors.
- No GitHub identity fields may ever appear on `aggregate` rows (§23 test).
- **Durable-identity minimization:** a linked contributor gets a durable
  `ownership_contributors` row **only when they are individually
  represented** in at least one retained result. Contributors that fall
  below the top-N threshold in every scope-period are aggregated into
  `other` **transiently, in memory** — no identity row is created solely
  for them. The fold happens during slice aggregation; overflow identities
  never reach storage.

### 6.5 Bots

`is_bot` heuristic (`[bot]` suffix, `bot` account type where exposed).
Bots are stored like any linked contributor and may be displayed
separately, but they are **not people** for metric purposes:

- `human_contributor_count`, `recent_human_maintainer_count`, and
  `top_human_contributor_share` all exclude `is_bot = true` by default —
  the metric basis is `identity_kind='linked' AND is_bot = false`.
- Automation must not make a module appear human-maintained or
  single-person-concentrated. Bot attribution may be surfaced as its own
  labeled figure, never merged into the human counts silently.

---

## 7. Private repository boundary

- Private-repo ownership data is reachable only through the owning session →
  `requireUser` → `user_id`-scoped RPCs — identical enforcement to existing
  analytics (§2.4).
- It must never appear on public/SEO/share surfaces (no share-card inclusion
  in V1 — see §25).
- `security_events`, structured logs, `repo_sync`/`ownership_sync_state`
  `error` fields, and analytics events must never carry private paths,
  contributor logins, repo names, or ownership values. The existing
  `syncErrorCode` closed-taxonomy pattern (`test/data-minimization.test.mjs`
  WS1) extends to the ownership phase with new codes.
- Concrete requirements: no `console.log` of paths/logins in the ownership
  pipeline; error classification happens at the throw site like
  `markRepoError`; `securityEvent` callers never pass paths as `sourceId`
  (sourceId is HMAC'd anyway, but taxonomy discipline stays).
- Backups: ownership rows enter the allowlisted dump (§20) — they contain
  private paths and contributor logins, which is *already true* of
  `repositories.full_name`; the dump's "treat as sensitive" handling
  (`disaster-recovery.md:104-106`) covers it unchanged.

---

## 8. Path storage — **decision: persist directory display paths, never file paths**

| Level | Decision | Reason |
|---|---|---|
| Repository scope | no path column value (null) | repo identity already persisted |
| Directory scope | `display_path` persisted | UI must label scopes after disconnect; directory names are the feature's organizing unit |
| File paths | **never persisted** | no file-level UI in V1; file names are the most revealing path component and provide zero product value stored |
| `scope_path_hash` | persisted | deterministic lookup/index key (e.g. sha256) for the **current** normalized path — used for joins/indexes instead of raw path text |

**Rename semantics — explicit:** a path hash changes when the path changes.
`scope_path_hash` claims **no** persistent scope lineage. In V1 a directory
rename or move produces a new path, a new hash, and therefore a **new scope
identity**; the old scope's history remains attached to the old path. The
resulting historical-path discontinuity is disclosed in the methodology
(§18). Rename lineage is **not** implemented in V1.

Why store display paths at all rather than hashes-only:

- Retain-history (`keep`) is a real mode; hashes-only renders the feature
  useless for every retained repo — contradicting §2.5 semantics.
- The product already persists `repositories.full_name` for private repos;
  directory names are a *bounded increment* of the same class, capped at
  depth ≤4 and ≤500 scopes/repo (RFC §18), excluding vendor/generated.
- Fetch-on-demand was rejected: retained repos cannot call GitHub (access is
  gone by definition of the mode).

Mitigations: normalize paths at ingest (canonical separators, trim); cap
stored path length (~200 chars, longer paths are excluded scopes);
exclude vendor/generated/binary/submodule trees **before** any path is
persisted — the exclusion check runs on enumeration output, in memory.

---

## 9. Temporary processing data

Allowed **in memory only** during a sync slice:

- `history(path:)` nodes: `oid`, `committedDate`, `author.user.{id,login}`
- blame ranges: `startingLine`, `endingLine`, `commit.{oid,committedDate,author.user.{id,login}}`
- tree enumeration output (paths, types, submodule/blob flags)
- per (scope × contributor × month) running aggregate accumulators
- rate-limit telemetry, latencies

Rules:

- Raw responses are reduced to §4.3 aggregates **within the slice**; they
  are never serialized to disk, DB, or logs.
- Resumable checkpoints are **cursors and counters only** (§4.4) — never
  response snapshots.
- No disk cache, no temp files in production V1.
- Slice-restart mid-walk: the accumulator for an in-flight scope is rebuilt
  by reading back that scope's existing provisional aggregate rows (upserts
  are set-valued, idempotent) — raw nodes are never re-storable.

### 9.1 Persistence handoff — hard constraint for Phase 1C-B (BLOCKER)

The Phase 1C-A reducer is correct **only** when it sees the complete node
set for each scope-period it finalizes. The following are hard constraints,
not implementation details, and they block all ownership writes until the
persistence tranche resolves them:

- **Page-local Top-25/Other folding is invalid.** The Top-25 boundary is
  defined over a *complete* scope-month's contributor set. Folding per
  fetched page fabricates wrong membership (a contributor who would rank
  inside the full-month Top-25 can be spilled, or vice versa).
- `human_contributor_count` must be computed over the **full transient
  contributor set** for the scope-month — never a page-local or folded
  subset. It must never silently cap at the Top-N boundary.
- **Overflow-only contributor identities must not be durably stored merely
  to simplify paging** — §6.4 durable-identity minimization is a hard rule,
  not a convenience; writing identity rows "temporarily" is still writing.
- **Advancing a GraphQL cursor independently from aggregate state can
  double-count or skip a page.** Aggregate written then crash before cursor
  → page reduced twice; cursor written then crash before aggregate → page
  never counted. Cursor/checkpoint writes must be **atomic with the
  aggregate state they describe**.
- Phase 1C-B must therefore design **and prove** a crash-safe
  accumulation/checkpoint strategy — atomic page checkpoints or
  equivalent set-valued, idempotent writes — **before any ownership write
  path is implemented**. This is an explicit blocker.

---

## 10. Production data model — final candidate

**Four tables — the smallest normalized model** satisfying isolation,
cascade, timeline, blame, resumability, and versioning.

**Database-enforced tenant consistency (hard requirement):** every
ownership table denormalizes `user_id` alongside `repository_id` for
scoping speed, and simple independent FKs would *not* prove the pair is
consistent — a bug could pair user A's `user_id` with user B's
`repository_id`. Phase 1B must enforce the pairing **in the database** with
composite foreign keys (application-side checks alone are insufficient):

- `repositories` gains a unique constraint on `(id, user_id)` (it already
  has `unique(user_id, github_repo_id)`; the composite surrogate unique is
  what ownership FKs target).
- Every ownership table declares
  `foreign key (repository_id, user_id) references repositories(id, user_id) on delete cascade`.
- `ownership_snapshots` additionally declares
  `foreign key (scope_id, repository_id) references ownership_scopes(id, repository_id) on delete cascade` and
  `foreign key (contributor_id, repository_id) references ownership_contributors(id, repository_id) on delete cascade`
  — a snapshot cannot pair a scope or contributor from one repository with
  another's repository_id, and both parents cascade with the repo.
- The required supporting uniques (`ownership_scopes(id, repository_id)`,
  `ownership_contributors(id, repository_id)`) are Phase-1B implementation
  detail, as is the exact SQL. The contract is: **the database itself
  rejects any cross-tenant or cross-repo pairing** (§23 tests prove it).

### `ownership_scopes`
PK `id`. Composite FK `(repository_id, user_id) → repositories(id, user_id)`
cascade. Unique `(repository_id, scope_path_hash)`. Index
`(repository_id, depth)` for bounded enumeration. Columns per §4.1.
Write: ownership ingestion. Read: dashboard RPCs join through it for labels.
Cardinality: ≤500/repo; ~50–200 typical.

### `ownership_contributors`
PK `id`. Composite FK `(repository_id, user_id) → repositories(id, user_id)`
cascade. Unique `(repository_id, contributor_key)`. Index
`(repository_id)` only — **deliberately no index on `github_node_id`**
(cross-tenant enumeration must not even be convenient). Columns per §4.2.
Cardinality: small — identity rows exist **only for contributors
individually represented in a retained result** plus the `unlinked` and
`other` synthetic rows (§6.4); overflow identities are folded transiently
and never persisted. ≤~30/repo typical.

### `ownership_snapshots`
PK `id`. Composite FKs `(repository_id, user_id) → repositories`,
`(scope_id, repository_id) → ownership_scopes`,
`(contributor_id, repository_id) → ownership_contributors` (null =
scope-total row), all cascade. Unique `(scope_id, contributor_id,
period_granularity, period_start, calculation_version)` — version is part
of row identity so served and building versions coexist — plus a partial
unique index for null-contributor scope-total rows. Index
`(repository_id, period_start)` for timeline queries. Columns per §4.3.
Cardinality: §11.

### `ownership_sync_state`
PK `(user_id, repository_id)`. Composite FK `(repository_id, user_id) →
repositories(id, user_id)` cascade. Columns per §4.4.
Cardinality: 1/repo.

**Rejected alternatives:** a fifth `ownership_scope_summaries` table
(folded into snapshots via null-contributor rows — one fewer table, same
query shape); folding sync state into `repo_sync` (kept separate: different
phases, different cursors, independent failure modes — but identical
conventions); a single mega-table (breaks cascade granularity and forces
path/login duplication per period row).

All four: RLS enabled, zero policies, `service_role` grants only — per the
established `007` pattern. `security invoker` `dash_ownership_*` functions,
`EXECUTE → service_role`.

---

## 11. Cardinality / storage model

Naive worst case (every scope × every contributor × every month populated):

| Size | Scopes | Contributors/scope | Months | Naive rows |
|---|---|---|---|---|
| small | 50 | 5 | 60 | 15,000 |
| medium | 200 | 10 | 120 | 240,000 |
| large | 500 | 25 | 120 | 1,500,000 |

**The naive model overstates reality** — rows are written only where a
contributor actually touched the scope that month (sparse writes). Real
activity concentrates: most scope-months have 1–3 actors, most contributors
aren't active every month. But honesty requires bounding the worst case
anyway. Guardrails, all enforced at write time:

1. **Sparse writes only** — zero-activity scope-periods produce no rows.
2. **Top-25 + "other"** per scope-period: the `unlinked` bucket always gets
   its own row and is never folded into `other`; linked contributors below
   rank 25 (by period touches) fold into an `identity_kind='aggregate'` row
   (`contributor_key='other'`, §6.4) **in memory** — overflow identities
   get no durable `ownership_contributors` rows. Caps fan-out at ≤27
   contributor rows per scope/period (25 linked + unlinked + other) plus
   one scope-total row.
3. **Per-repo snapshot cap** — e.g. 300k rows/repo: on breach, deepest
   **already-persisted, otherwise-valid** scopes are omitted from analysis
   and flagged `excluded='cardinality_cap'` — the only legitimate use of
   the excluded fields, since UI must distinguish "not analyzed due to
   limits" from "doesn't exist" (vendor/generated/binary/submodule paths
   never reach the table at all — §8). This converts unbounded worst cases
   into bounded degradation of granularity, never unbounded storage.
4. **HEAD rows are ≤ ~28/scope** — up to 25 linked + 1 unlinked + 1
   `aggregate` + 1 scope-total row per scope, one `head` snapshot each —
   small relative to monthly history, but not one row per scope.

Worked result: medium repo at 20% sparsity ≈ 48k rows; large repo hits the
cap and degrades to shallower scope coverage instead of 1.5M rows. Postgres
handles 300k indexed rows trivially — the cap exists for hygiene and
per-tenant fairness, not database survival.

---

## 12. Historical retention — **decision: full monthly history, no compaction in V1**

- Monthly granularity is retained **indefinitely while the repository
  remains connected or retained** — same retention semantics as `commits`
  today (§2.5, §2.6).
- No quarterly compaction in V1: §11 guardrails bound volume well below the
  point where compaction's added complexity (and altered interpretation —
  a quarterly bar is not four monthly bars) is justified. Compaction remains
  a `calculation_version`-gated option for later if measured cardinality
  demands it.
- Disconnected-but-retained repos keep their ownership history — consistent
  with "history stays because you chose to keep it."

---

## 13. Recalculation + algorithm versioning

- `calculation_version` is **part of snapshot row identity** (§4.3
  uniqueness) — version N and N+1 rows coexist in the table simultaneously.
- `ownership_sync_state` carries two explicit versions:
  - `active_version` — the version dashboard reads serve, **null until the
    first build completes**;
  - `building_version` — the version currently being written, or null.
- **Serve gate:** dashboard functions return only rows where
  `calculation_version = active_version`. `active_version IS NULL` → the
  repo returns "ownership not ready / unavailable" — partial rows of an
  in-progress first build are never exposed; results from two versions are
  never mixed in a response.

Initial bootstrap (the first-ever build for a repo):

- `active_version = null`, `building_version = 1` — ingestion writes V1
  rows while the dashboard reports "not ready".
- On validated completion: atomically `active_version = 1`,
  `building_version = null` — V1 becomes visible in a single update.

Version bump flow (N → N+1, same machinery):

1. `active_version=N`, `building_version` set to N+1; scopes re-marked
   pending.
2. All N+1 rows are written **alongside** N rows — nothing is deleted.
3. Version N remains fully queryable for the entire rebuild.
4. When every scope validates complete, `active_version` flips to N+1 and
   `building_version` clears — a single-row update, so the flip is atomic.
5. **Only after the flip** are old N rows garbage-collected. The active
   version is never deleted during an unfinished rebuild.

Failure/rollback semantics:

- An interrupted rebuild resumes via §4.4 cursors; the serve gate keeps N
  live throughout.
- Abandoning a rebuild (rollback **before** the flip): clear
  `building_version`, delete N+1 rows — N is untouched.
- There is no post-flip rollback to old rows (they may be collected);
  rolling back means rebuilding N as the next `building_version` — same
  machinery, no special case.
- Identity-normalization or exclusion-rule changes are exactly what a
  version bump is for.
- Feature-level rollback (ingestion flag off): ownership reads keep serving
  `active_version` (or nothing if none was ever completed); additive tables
  stay inert; `drop table` is a separate later cleanup migration if ever
  wanted (§21).

---

## 14. Deletion semantics (required future behavior)

| Control | Behavior for ownership |
|---|---|
| **Stop syncing / keep history** (`mode='keep'`) | Ownership aggregates remain queryable; `ownership_sync_state` phase frozen; no new GitHub calls for that repo (existing `disconnected_at` gate — `lib/sync.mjs:353`, `489`, `api/webhooks/github.mjs:203`) |
| **Resume** (`mode='resume'`) | Sync state picks up from persisted cursors; incremental from `last_processed_sha`/`last_processed_at` |
| **Disconnect & delete** (`mode='delete'`) | `repositories` row delete **cascades** all four ownership tables — scopes, contributors, snapshots, sync state. The explicit per-table deletes in `api/user.mjs:119-124` need no ownership entries *if* FKs are `on delete cascade` — spec: cascade (differs from commits' historical `set null`, intentional: ownership rows are meaningless without their scope/repo rows) |
| **Delete my data** (`DELETE /api/user?confirm=1`) | `users` delete cascades through everything including ownership (user_id FKs present on all four tables for exactly this) |
| **GitHub uninstall / repo removal** | `disconnect_source='github'` → retain semantics identical to `keep` — no ownership API calls, data kept, auto-reconnect on re-grant |

**Zero orphans** is a §23 test: after either delete path, all four tables
must contain no rows for the repo/user.

---

## 15. RLS / database security

Mirroring the audited production convention (§2.4):

- `enable row level security` on all four ownership tables; **zero
  policies** — closed second barrier.
- `grant select, insert, update, delete on <tables> to service_role` —
  nothing to `anon`/`authenticated`/`public` (default-privilege revokes from
  `007` already cover new tables; explicit grants stay written anyway for
  readability and the drill's privilege assertions).
- No browser may query any ownership table directly — enforced doubly (no
  grants + RLS).
- Dashboard access only through `dash_ownership_*` SECURITY INVOKER
  functions taking `p_user` and scoped `where user_id = p_user`,
  `EXECUTE → service_role` — same shape as `dash_daily` (`migrations/007:62`).
- **Honest isolation claim:** cross-tenant ownership access is prevented by
  authenticated API scoping (`requireUser` → internal `user_id`) plus
  explicit `user_id` constraints on every read/write path — the server-side
  `service_role` data path bypasses RLS by design, so isolation *depends on*
  those constraints being correct everywhere, which is why the §23
  foreign-user behavioral tests are mandatory. RLS with zero browser
  policies and revoked browser grants provides an independent barrier
  against direct client access only — it is not the tenant-isolation
  mechanism for server queries.

---

## 16. Dashboard API contract (RPC foundations deployed dormant; consumer not implemented)

The `dash_ownership_*` invoker RPCs are deployed (migration 012) but dormant
— `active_version` is never set, so they return nothing. A future API layer
feeds the ownership section through them. Smallest
useful payload shape per repository:

```jsonc
{
  "repository": "<full_name>",
  "scopes": [
    {
      "path": "src/api",            // null → repository scope
      "depth": 2,
      "excluded": false,
      "humanContributorCount": 6,          // linked ∧ not-bot only — unlinked/other/bots are not people
      "recentHumanMaintainerCount": 3,     // linked ∧ not-bot only
      "topHumanContributorShare": 0.42,    // among human attributable contributors only
      "unlinkedTouchShare": 0.19,          // unresolved attribution — reported separately
      "unlinkedSurvivingLineShare": 0.15,
      "attributionQualified": true,        // unresolved share is material → UI must qualify concentration figures
      "head": [
        { "contributor": "someone", "kind": "linked", "bot": false,
          "survivingLineShare": 0.31, "lastMeaningfulTouch": "2026-09-14" },
        { "contributor": null, "kind": "unlinked",
          "survivingLineShare": 0.15, "lastMeaningfulTouch": "2024-11-02" },
        { "contributor": null, "kind": "aggregate",
          "survivingLineShare": 0.08, "lastMeaningfulTouch": "2025-03-01" }
      ],
      "timeline": [
        { "period": "2026-08", "contributor": "someone",
          "touchShare": 0.55, "touchCommits": 11 }
      ]
    }
  ],
  "calculationVersion": 1
}
```

**Never exposed:** internal uuids beyond repo/scope identity already sent
today, `github_node_id`/any GitHub account ids, `contributor_key`, commit
SHAs, emails, raw blame ranges, raw history nodes, sync cursors. Linked
contributors appear as **current login only**; `kind: "unlinked"` renders
"Unlinked contributor" (unresolved attribution, not a person);
`kind: "aggregate"` renders "Other contributors" (excess linked
contributors under the top-25 cap — likewise not a person). Neither is ever
counted in `humanContributorCount`, `recentHumanMaintainerCount`, or
`topHumanContributorShare`; bots (`bot: true`) are excluded from those
fields too and may only be shown separately labeled.

---

## 17. Future Security & Privacy page changes required at ownership launch

**Draft only — `SecurityPrivacyPage.tsx` is NOT edited in this phase.** Copy
below lands in the same release train as the feature (RFC §18 requirement),
never before it is true.

**§01 WHAT DEV LEDGER ACCESSES — replace the COMMITS row:**

> ['COMMITS', 'Commit SHA, committed timestamp, additions, and deletions.
> For your own metrics, only commits GitHub attributes to your account are
> stored. For ownership analysis, authorship metadata for other contributors
> to your authorized repositories is read and reduced to monthly ownership
> aggregates — their individual commits are never stored.'],

> ['OWNERSHIP', 'Git blame attribution ranges (line counts and contributor
> identity only — never line content) and path-filtered commit history for
> repository and directory scopes.'],

**§02 WHAT DEV LEDGER STORES — add:**

> ['OWNERSHIP', 'Derived ownership aggregates: for each repository and
> directory scope, per-contributor monthly touch counts and shares, HEAD
> surviving-line shares, human-contributor counts and
> unresolved-attribution shares, and first/last activity dates.
> Linked contributors are identified by their GitHub account identity and
> current username — the minimum needed to label ownership results;
> contributions GitHub cannot link to an account are grouped under a single
> "Unlinked contributor" label and reported separately from named
> contributors.'],

**§03 WHAT DEV LEDGER DOES NOT STORE — amend AUTHOR IDENTIFIERS:**

> ['AUTHOR IDENTIFIERS', 'Individual commit and pull-request rows still
> belong to your account by construction — other people\'s commits are never
> stored as records. Ownership analysis stores only the minimal linked
> GitHub identity needed to label ownership results, plus derived
> repository/directory aggregates (section 02). Contributor email addresses
> are never requested or stored.'],

> (SOURCE CODE, COMMIT MESSAGES, PULL-REQUEST TITLES, EMAIL ADDRESS, ACCESS
> TOKENS, WEBHOOK PAYLOADS rows are unchanged — all still true. Add
> 'RAW BLAME & HISTORY', 'Raw blame ranges, raw commit-history responses,
> and file contents are reduced to aggregates during sync and never
> persisted.')

**§04 GITHUB ACCESS & PERMISSIONS — append one bullet:**

> ▸ Ownership analysis uses the same read-only Contents and Metadata
> permissions — no new GitHub permissions were required.

**§08 YOUR DATA CONTROLS — amend DISCONNECT & DELETE and DELETE MY DATA:**

> ['DISCONNECT & DELETE', 'Permanently removes the repository record and its
> stored commits, pull requests, language data, ownership aggregates,
> coverage, and repository-specific sync bookkeeping.']

> ['DELETE MY DATA', '… cascading through installations, repositories,
> languages, commits, pull requests, ownership data, feedback submissions,
> and sync state.']

Tone check: every clause is factual and mirrors behavior — no "secure",
"private", or expertise claims.

---

## 18. Methodology disclosure (user-facing, ships with Ownership UI)

Fixed statement, displayed on the section:

> **"Ownership is an estimate of historical contribution and familiarity,
> not proof of expertise, responsibility, or value."**

Signal definitions:

- **HEAD surviving-line share** — share of lines in files that exist today
  last authored by each contributor, per GitHub blame. Measures *current
  familiarity*, not importance.
- **Historical touch share** — share of commits that touched this scope in
  each month. It is a maintenance-activity signal, **not** a percentage of
  the code or of its value.
- **Recent maintainer activity** — contributors with path touches in the
  recent window.
- **Unlinked contributor** — Git history that GitHub cannot associate with
  a GitHub account, for example historical commit identities that are not
  linked to an account. Dev Ledger does not use email or author-name
  reconstruction to guess who those commits belong to. This bucket can be
  material — it measured 18.6% of surviving lines on one sampled large
  public repository — and it is reported as unresolved attribution, never
  as a single contributor.
- **Concentration metrics** — contributor counts, recent-maintainer counts,
  and top-contributor share are computed over attributable **human**
  contributors only (linked accounts, bots excluded by default).
  "Unlinked contributor" and "Other contributors" are unresolved/synthetic
  groupings, not people, and are never counted as individuals; bot
  activity may be shown separately labeled. Where unresolved attribution
  is material, concentration figures are qualified as covering
  attributable human attribution only.

Limitations, stated plainly: squash merges attribute the squashed commit to
its author, not its original writers; renames and cross-directory moves can
split history at the move boundary (observed behavior — not a universal
guarantee), and a renamed or moved directory is treated as a new scope —
its ownership history does not carry across the move in V1; whole-file
rewrites distort surviving-line share; authorship is not review, design,
or operational responsibility.

No productivity, ranking, or "top developer" language anywhere.

---

## 19. Analytics / telemetry contract

Ownership events join the existing allowlist model (PostHog custom events,
`EVENT_SPEC` discipline for security events). Allowed:

- `ownership_section_viewed`, `ownership_scope_opened`, `ownership_error_shown`
- Safe dimensions only: route, depth bucket (`0|1|2|3|4`), repo
  public/private boolean **if** consistent with current analytics policy,
  loading/error state, calculation_version.

Never sent: repo names, paths, contributor logins or ids, shares tied to
identity, private-repo metadata of any kind, free text, scope counts that
could fingerprint a specific repo. Same bar as §09 of the trust record —
the allowlist test (`test/posthog-analytics.test.mjs`) extends to assert no
ownership event carries these.

---

## 20. Backups / recovery

- All four ownership tables enter `BACKUP_TABLES` in
  `scripts/backup-scope.mjs` — classification **is mandatory**: an
  unclassified new table fails CI by design.
- **Classification — not uniformly reconstructable:**
  - **CORE:** `ownership_scopes`, `ownership_contributors`,
    `ownership_snapshots`. Losing these is real, user-visible historical
    data loss: a disconnected-but-retained repository may no longer be
    readable from GitHub at all, yet the product intentionally keeps its
    historical analytics (§14). For those repos the aggregates are
    **irreplaceable**, not merely expensive to rebuild.
  - **OPERATIONAL:** `ownership_sync_state` — cursors/phase markers;
    losing it means a re-ingest, same reasoning as `repo_sync`.
- Normal retention applies (7 daily / 4 weekly). Repository/account deletion
  does not rewrite historical dumps — disclosed on the trust page §08.
- Restores preserve tenant isolation: the `user_id`/composite FKs are part
  of the dump.
- No backup-behavior change in this phase; classifying tables happens in the
  Phase 1B migration PR, and the §23 test asserts the CORE/OPERATIONAL
  split.

---

## 21. Migration strategy (future order)

1. Additive migration `012_ownership.sql`: four tables, FKs, indexes, RLS,
   service_role grants, `dash_ownership_*` invoker functions (returning
   empty until data exists).
2. `scripts/backup-scope.mjs` classification (same PR).
3. Extend `test/data-minimization.test.mjs` + isolation tests (§23).
4. Ingestion code, **feature-flagged off by default** (§22).
5. Privacy-copy amendment + methodology copy ready in the same release
   train as UI enablement (§17 — never earlier).
6. Internal/owner account → selected repos → small repos → wider → large.
7. UI activation.

**Rollback at every stage:** flag off → additive tables inert → later
cleanup migration drops them only if permanently abandoned. No destructive
migration is ever required to ship or roll back.

---

## 22. Feature flag / rollout — **decision: yes, internal flag**

`OWNERSHIP_ENABLED` env gate + per-user allowlist for stage 1. Gates between
stages use spike-measured thresholds:

| Stage | Scope | Gate to advance |
|---|---|---|
| 1 | owner account, ≤3 small repos (<500 files) | error-free full cycle; row counts within §11 model |
| 2 | a few private repos ≤2k files | no permission errors; private-path leak check on logs |
| 3 | medium repos (~5k files) | multi-slice resumption verified; **HEAD-blame** GraphQL spend consistent with the measured ~2%-of-hourly-floor figure from the spike |
| 4 | general availability + large repos | 50-alias ceiling holding; response-size guards never tripped spuriously; **total ownership-cycle budget (history walks + blame) measured during stages 1–3 and a production total-cycle budget established from those measurements before GA** |

The spike measured ~100 GraphQL points for a 5k-file **HEAD blame pass**
under 50-alias batching — it did **not** measure the full ownership cycle
including `history(path:)` walks. The 2% figure applies to the blame phase
only; the total-cycle budget must come from staged-rollout measurement, not
extrapolation.

Large-repo analysis stays resumable multi-slice (a ~5k-file repo spans
multiple 45s slices — measured in the spike report §alias/latency data).
Governed by wall-clock budget + response-size guard + persisted cursor, with
GraphQL points as the secondary guard.

---

## 23. Test contract for implementation (Phase 1B/1C MUST add)

**Privacy persistence**
- Ownership writers persist no source text, messages, emails, raw blame
  ranges, raw history nodes, or per-commit contributor rows — source-level
  guards like `data-minimization.test.mjs` WS2/WS3.
- `error` fields accept only closed taxonomy codes (extend WS1).

**Isolation**
- Foreign-user behavioral tests are mandatory: RPCs invoked with another
  tenant's `p_user` return nothing; the API never serves ownership rows
  outside the session's `user_id`; no unscoped query exists in source
  (source-scan + behavioral).
- Private-repo ownership never crosses tenant; never appears in share/public
  payloads.

**Deletion**
- Repo `mode='delete'` leaves zero rows in all four tables.
- Account delete leaves zero rows.
- `keep` retains rows but produces zero new GitHub calls (mock-octokit
  assertion).
- `resume` continues from cursors.

**Tenant consistency (database-enforced)**
- Deliberately mismatched inserts are rejected: `user_id` of tenant A paired
  with `repository_id` of tenant B fails at the composite FK.
- A snapshot pairing a scope or contributor from repo X with a different
  `repository_id` fails at the composite FK.
- These are database-constraint tests (fixture Postgres / drill), not just
  application-mock tests — application-only checks are insufficient.

**Identity**
- Linked contributor durable key is `github_node_id` (GraphQL
  `author.user.id`); login refreshable; `databaseId` never requested.
- All unlinked attribution lands in exactly one `identity_kind='unlinked'`
  row per repo; no email or name-derived keys; `github_node_id`/
  `display_login` always null.
- `identity_kind='aggregate'` rows carry no GitHub identity fields and are
  never treated as people; `unlinked` is never folded into `other`.
- Contributors represented **only** inside `other` get no durable
  `ownership_contributors` row — overflow identities stay transient.
- `human_contributor_count`, `recent_human_maintainer_count`, and
  `top_human_contributor_share` exclude `unlinked`, `aggregate`, **and
  `is_bot` rows**; bots may appear only as separately labeled figures.
- `is_bot` set correctly.

**Versioning**
- `calculation_version` is part of snapshot uniqueness — V1 and V2 rows
  coexist safely.
- **First build:** `active_version` null + `building_version` 1 → partial V1
  rows are never served; repo reports "not ready".
- **Promotion:** validated completion flips `active_version` atomically and
  clears `building_version`.
- V1 remains fully readable for the entire V2 rebuild.
- Dashboard serves `active_version` rows only.
- An incomplete `building_version` is never exposed.
- The atomic `active_version` flip changes served results in a single
  update.
- Old-version rows are garbage-collected only after the flip — the active
  version is never deleted mid-rebuild.
- Rollback before the flip leaves `active_version` data untouched.
- Two versions never mix within a single response.

**Scope exclusion**
- Vendor/generated/binary/submodule directory paths are never persisted —
  no `ownership_scopes` row exists for them.
- `excluded`/`exclusion_reason` is only ever set on otherwise-valid
  persisted scopes omitted by the cardinality cap.

**API**
- Response contains no internal ids/node ids/SHAs/emails; `contributor:
  null` for `unlinked` and `aggregate` rows; concentration fields carry the
  human-only basis and `attributionQualified` flag.

**Telemetry**
- No ownership event carries repo names, paths, or logins (allowlist test).

**Backup scope**
- `ownership_scopes`/`ownership_contributors`/`ownership_snapshots` are in
  `CORE_TABLES`; `ownership_sync_state` is in `OPERATIONAL_TABLES` — the
  test asserts the split, not just presence (existing unclassified-table CI
  failure proves classification can't be skipped).

---

## 24. Security threat model — delta introduced by ownership

| New risk | Mitigation |
|---|---|
| Third-party contributor identity stored | §5 identity contract; repo-scoped only; no global table; deletes cascade |
| Private directory-path leakage | §8: dirs only, depth/length caps, vendor exclusion pre-persist; §7 log/telemetry ban |
| Contributor profiling misuse | §25 product guardrails; repo→contributor organizing unit; no cross-repo person views |
| Cross-tenant joins | no `github_node_id` index; every read path carries an explicit `user_id` constraint under authenticated API scoping; mandatory foreign-user behavioral tests (§23) |
| Cardinality/storage abuse via hostile repos | §11 top-25+other, per-repo cap, depth/scope caps, exclusion rules |
| Malicious/weird path names | normalization + length cap + exclusion rules; paths never hit logs/telemetry |
| Dashboard enumeration of others' repos | RLS zero-policy + service_role-only + `p_user`-scoped invoker RPCs (§15) |
| Stale login display after GitHub rename | login refreshed each recalc; node id is the key, never the label |
| Aggregation-creep (stored model drifts finer) | §5 anti-creep rule + §23 source guards + review gate |
| Sync of retained repos calling GitHub | `disconnected_at` gate already covers ownership phase — §23 test asserts zero calls |

---

## 25. Product guardrails

Ownership must never become employee ranking, productivity scoring,
performance evaluation, leaderboard, surveillance, or HR tooling.

Enforcing constraints, not just words:

- **Organizing unit is `repository/directory → contributors`** — the schema
  has no contributor-rooted index; a "show me everything person X did"
  screen is unbuildable on this model without new queries, which is the
  point.
- No V1 cross-repository per-person rollup, no scores, no bus-factor number
  (RFC §17 — inputs only), no share-card/export of ownership in V1.
- Terminology stays "coverage / concentration / recent activity / unlinked."
- Methodology disclosure (§18) is rendered wherever the numbers appear.

---

## 26. Final go/no-go checklist — gates before Phase 1B persistence starts

- [x] ownership field list approved (§4)
- [x] prohibited-data contract approved (§5)
- [x] identity treatment approved (§6: repo-scoped, node-id key, login
      stored, single unlinked bucket)
- [x] private-path storage policy approved (§8: dir paths yes, file paths
      never, caps + exclusions)
- [x] deletion semantics approved (§14: cascade, no orphans)
- [x] RLS model approved (§15: zero-policy + service_role + invoker RPCs)
- [x] public privacy-copy draft approved (§17 — lands only in release train)
- [x] methodology language approved (§18)
- [x] telemetry restrictions approved (§19)
- [x] migration/rollback plan approved (§21)
- [x] feature-flag rollout approved (§22)
- [x] implementation test contract approved (§23 — includes
      version-coexistence, foreign-user isolation, and unlinked/aggregate
      semantics tests)

**All contract gates are decided.** Remaining operational notes: §17 copy
lands only in the release train where the feature becomes true; the total
ownership-cycle budget must be measured during staged rollout before GA
(§22).

---

## Decisions summary (the six required calls)

| # | Question | Decision |
|---|---|---|
| 1 | Directory display paths or hashes only? | **Store `display_path` for directory scopes** (bounded: depth ≤4, ~200 chars, vendor/generated excluded); repo scope stores none; **file paths never**; `scope_path_hash` for lookup |
| 2 | Linked login persisted or node ID only? | **Both**: `github_node_id` (GraphQL `User.id`) durable key + `display_login` for display; refreshed each recalc; numeric `databaseId` not requested |
| 3 | One unlinked bucket vs pseudonymous? | **One "Unlinked contributor" bucket per repo** — unresolved attribution, not a person; excluded from contributor-count/concentration metrics and never folded into `other` |
| 4 | Monthly indefinitely vs compaction? | **Full monthly, no compaction in V1** — sparse writes + top-25/other + 300k/repo cap bound volume; compaction stays a version-gated option |
| 5 | Separate HEAD table vs mixed? | **One `ownership_snapshots` table**; `period_granularity='head'` + sentinel `period_start` distinguishes HEAD rows |
| 6 | Global vs repo-scoped contributor identity? | **Repository-scoped** — no global contributor table, no cross-tenant index or join, ever |

---

## 27. PROPOSED amendment — ephemeral build working state (NOT LIVE)

> **Status: proposed only.** Recorded by the Phase 1C-B0 checkpoint design
> ([ownership-checkpoint-architecture.md](ownership-checkpoint-architecture.md)).
> Nothing below is implemented, migrated, or approved for production. It
> becomes contract only if the implementation tranche is approved.

The §9.1 blocker analysis reached a proved conclusion: **exact**
Top-25/Other membership and `human_contributor_count` require the complete
per-contributor set of a scope, while a `history(path:)` walk can span many
invocations — so exact crash-safe accumulation requires *some* durable
per-contributor intermediate state, and none of the four 012 tables can
hold it without violating this contract (snapshots require a durable
contributor FK; the linked-contributor CHECK forces identity fields; the
sync-state JSONB is backed up, unbounded, and unconstrainable).

Terminology for this amendment is exact: **EPHEMERAL** means short-lived
*persisted* operational state — written to Postgres, but backup-excluded,
never browser/API-exposed, never logged or telemetered, deleted at scope
finalization or on build-abort cleanup, and fully reconstructable by
restarting the build. **RETAINED** means durable, backed-up, user-visible
ownership data (`ownership_scopes`, `ownership_contributors`,
`ownership_snapshots` at `active_version`). Persisted ≠ retained.

The proposed amendment is deliberately narrow:

1. **New data class — EPHEMERAL build working state, two relations.** (a)
   Per (scope × month × work_key) touch counters plus the `is_bot`
   boolean and min/max `committedDate`, existing only while
   `building_version` is set for that repository. (b) Per
   represented-work-key identity staging carrying exactly
   `github_node_id`, `display_login`, `is_bot`, existing only between a
   scope's completed accumulation and its finalization. `work_key` is the
   same `contributor_key` defined in §5/§6 — a **deterministic,
   repository-scoped pseudonymous identifier** derived from GitHub node
   identity: no plaintext identity, not user-displayable, linkable within
   the repository, and therefore not anonymous. It may appear in
   persisted build state only under the EPHEMERAL conditions above —
   service-role-only, backup-excluded, never logged, deleted at
   finalization, cascade-deleted, swept on abandoned builds.
2. **The §6.4 guarantee is preserved verbatim** — overflow-only
   contributors still get **no retained identity row** and their GitHub
   identity fields (`github_node_id`, `display_login`) are **never
   persisted in any table**. Staged identity rows are written only for
   contributor keys pass 1 already proved individually represented;
   `ownership_contributors` rows are created **only inside the atomic
   scope-finalization transaction**, never during page-by-page resolve —
   so an abandoned scope can never orphan a durable identity.
3. **Two-pass identity resolution, attribution-frozen.** The accumulate
   pass fixes every metric (work keys, counts, Top-25, unlinked share,
   human counts, bot flags); the resolve pass re-reads
   `author.user.{id,login}` solely to stage identities for represented
   keys and cannot mutate metrics. A required key that stays
   unresolvable fails the scope closed and restarts at a fresh
   accumulate — GitHub's account-link resolution can change independently
   of the pinned commit, and the build succeeds only while selected keys
   remain resolvable.
4. **Build-boundary SHA.** `ownership_sync_state.history_cursor` may carry
   the build's pinned commit oid in addition to page cursors — a second
   sanctioned SHA beside `last_processed_sha` (§5.12), required because
   `defaultBranchRef` resolves at query time and multi-page builds must
   not straddle pushes.
5. Rejected within the design: provisional persistence of
   `github_node_id`/`display_login` for contributors not yet proven
   represented (optimistic identity maps, provisional contributor rows);
   JSONB accumulators inside `ownership_sync_state` (backed up,
   unbounded); and folding pass-1-linked contributors into `unlinked`
   when they unlink during pass 2 (unimplementable — a null `author.user`
   carries no node id mapping back to the work key; pass-2 non-resolution
   instead fails the scope closed).

If this amendment is rejected, the honest alternatives are: (a) accept
per-scope restart-in-single-invocation with no completion guarantee on
long histories, or (b) accept approximate/page-local folding — both
rejected in the design document.
