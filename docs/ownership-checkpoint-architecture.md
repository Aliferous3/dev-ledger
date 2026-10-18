# Ownership Checkpoint Architecture — Phase 1C-B0 Design

> **Status: design only, revision 4. Nothing in this document is implemented
> or live.** Revision 3→4 correction — **ephemeral-loss semantics**: because
> `ownership_contributor_build_work` accumulates across already-finalized
> scopes, losing any required ephemeral state invalidates the ENTIRE
> building version — there is one canonical `own_abandon_build` operation
> reused by the stale sweep, restore reconciliation, operator abort, and
> invalid-state recovery; a build never resumes piecemeal. Revision 2→3 —
> **version isolation**: shared `ownership_contributors` rows are never
> mutated during a build (RPCs version-filter snapshots only); metadata is
> staged build-level and applied atomically at promotion. Earlier:
> durable contributor writes inside the atomic scope-COMMIT only; the
> unimplementable resolve-drift fold removed; `work_key` classified as a
> linkable pseudonymous identifier; concrete TTL/cleanup; slim cursor
> jsonb.
>
> This document resolves the §9.1 hard blocker in
> [ownership-data-privacy-spec.md](ownership-data-privacy-spec.md): how to run
> a `history(path:)` walk that spans many GitHub pages and many serverless
> invocations while preserving every privacy/minimization invariant and
> producing results **bit-identical** to the Phase 1C-A one-shot reducer.
>
> Inputs: `migrations/012_ownership.sql`, `lib/ownership/*` (merged via
> PR #78, head `cb0a6fa`), `docs/ownership-graphql-spike-results.md`,
> `scripts/backup-scope.mjs`.

---

## 0. The contradiction, stated plainly

The Phase 1C-A reducer is only correct when it sees the **complete** node set
of a scope before folding, because Top-25 membership,
`human_contributor_count`, the `other` fold, and the durable-identity
decision are all functions of the whole set. But a scope walk can span tens
or hundreds of pages, and a serverless invocation holds memory only for
~45–60 s.

- Persist nothing per-contributor → a crash loses the counts; restart must
  re-walk the prefix → no completion guarantee (Option A fails, §3.1).
- Persist every contributor's identity provisionally → overflow GitHub
  identities reach storage → violates §6.4 durable-identity minimization
  and §9 "in memory only".

**Finding: there is no architecture that satisfies exactness, crash safety,
and identity minimization using only the four existing tables.** The minimum
amendment is ephemeral, backup-excluded working state — counters plus a
narrow pass-2 identity-staging relation — plus one atomic checkpoint
primitive. §5 below; the required contract amendment is recorded in §8 and
in the spec's proposed-amendment appendix.

---

## 1. Fundamental verdict: four tables are NOT sufficient

Checked against `012_ownership.sql` as deployed:

| Candidate storage | Why it cannot carry work state |
|---|---|
| `ownership_snapshots` | Contributor rows require `contributor_id` → a durable `ownership_contributors` row → requires `github_node_id`/`display_login` non-null (`ownership_contributors_linked` CHECK). Overflow identities would be written. Also no month-keyed accumulation shape without polluting immutable period facts. |
| `ownership_contributors` | The linked CHECK **forces** `github_node_id` + `display_login` — pseudonym-only provisional rows are impossible by construction, and persisting identities there is exactly what §9.1 forbids. It is also **retained, version-shared reference state** — not scoped to `calculation_version` — so it cannot be used as build scratch space at all (§4.4). |
| `ownership_sync_state` (`history_cursor`/other jsonb) | Technically possible, rejected in §3.2: it is OPERATIONAL (dumped into backups — provisional pseudonyms would leak into every dump), a single JSONB row is a read-modify-write hotspot with unbounded growth, and it cannot be CHECK-constrained per element. |
| `ownership_scopes` | Scope definition only; nothing accumulates there. |

Conclusion: **migration 013 is required.** The delta is minimal (§11): two
ephemeral work relations + one checkpoint function. No existing column or
constraint changes.

---

## 2. Terminology — EPHEMERAL vs RETAINED

These words must be exact, because the work rows **are** persisted in
Postgres while a build runs:

- **EPHEMERAL / short-lived persisted operational state** — rows written
  solely to make a multi-invocation build resumable. Intentionally
  short-lived: deleted at scope finalization or on build-abort cleanup,
  excluded from backups, never served by any API or RPC, never logged or
  telemetered, fully reconstructable by restarting the build. Persistence
  ≠ retention.
- **RETAINED ownership data** — `ownership_scopes`,
  `ownership_contributors`, `ownership_snapshots` at `active_version`:
  durable, backed-up, user-visible, deleted only by disconnect/account
  deletion.

The entire privacy boundary of this design is: *overflow contributors may
appear in ephemeral state only as the pseudonymous work key below, and
their GitHub identity fields may never appear in any persisted state.*

---

## 3. `work_key` privacy classification — corrected

`contributor_key` (`sha256(domain ∥ repo_uuid ∥ node_id)`) is a
**deterministic, repository-scoped, pseudonymous identifier derived from a
GitHub account identity**. Precisely:

- contains no plaintext node id or login;
- is not user-displayable;
- is scoped to exactly one repository;
- **is linkable within that repository** — the same GitHub account always
  produces the same key, and anyone holding the repository uuid plus a
  candidate node id can test membership. It is therefore **not anonymous
  data**, only pseudonymous.

It may be used in persisted build state only under all of these conditions:

- short-lived (counter rows deleted at scope finalization; build-level
  staging deleted at promotion/abort; all swept on abandoned builds);
- `service_role`-only access, zero browser/API exposure;
- never logged, telemetered, or placed in error fields;
- excluded from backups;
- cascade-deleted on repository/account deletion.

The stronger rule stands unchanged: **overflow-only contributors never
receive retained `ownership_contributors` identity rows** — the pseudonym's
ephemeral appearance does not create an identity record of any kind.

Rejected alternative — a build-nonce key
(`hash(domain ∥ nonce ∥ repo ∥ node_id)`): it adds nothing under the same
threat model (both are sha256 pseudonyms; a preimage attacker breaks either)
and it **breaks Top-25 tie determinism** — the reducer ranks by
`touch_commits desc, contributor_key asc`. With nonce keys the rank-25
tiebreak changes every build unless a key-mapping pass re-derives final
keys, an unforced correctness risk. Deterministic keys make work-row
ordering literally equal to final ordering — determinism by construction.

**Rejected outright:** persisting `github_node_id`/`display_login` for
contributors not yet proven represented (an "optimistic" identity map).
That stores real identity for potentially-overflow contributors — a
*qualitative* expansion of stored PII, not a quantitative one. Pass-2
staging (§4.4) exists only for keys already proven represented.

---

## 4. Options evaluated

### 4.1 Option A — no provisional persistence (restart-in-invocation)

Correctness if a scope completes in one invocation: fine. The failure is the
completion guarantee:

- Measured: ~0.5 s per 100-node history page (spike TEST B).
- Slice budget: 45 s webhook/cron slices inside `maxDuration: 60`.
- → ~80 pages ≈ 8,000 commits per invocation at best.
- A repository scope walks **all** history. A 20k-commit repository needs
  ~200+ pages ≈ 100 s — **the repo scope alone can never finish in one
  invocation.** Pathological months/dirs make it worse.
- Restart amplification: a crash at page N re-spends N pages of rate limit
  and wall-clock; under shared 5,000 pt/hr quota this can starve sync.
- There is **no hard bound** on "a month/scope fits one invocation" —
  failure is permanent, not slow.

**Rejected — no completion guarantee.**

### 4.2 Option B — JSONB accumulator inside `ownership_sync_state`

- `ownership_sync_state` is classified **OPERATIONAL → included in every
  pg_dump** (`backup-scope.mjs:40-47`). Provisional pseudonyms would be
  written into every daily/weekly dump and retained per backup retention —
  directly contrary to the ephemeral classification this data needs (§9).
- Single row per repo: every page checkpoint rewrites the whole JSONB —
  O(accumulator size) write amplification per 100-node page; MVCC dead
  tuples on a hot row; TOAST churn as the blob grows.
- Unbounded: `contributors × months` can reach tens of thousands of entries
  (§6); no per-element CHECK constraint possible; a corrupt blob is
  unparseable as a unit.
- Breaks the one-scope-at-a-time bound: the jsonb accumulates all in-flight
  scopes at once.

Atomicity is the one thing B gets right (single-row update is atomic), but
everything else fails. **Rejected.**

### 4.3 Option C — provisional rows in existing ownership tables

- `ownership_contributors_linked` CHECK *requires* `github_node_id` +
  `display_login` for linked rows — the schema itself forbids pseudonym-only
  provisional contributors. Weakening the CHECK to admit provisional rows
  weakens the durable contract to accommodate the mechanism: backwards.
- `ownership_contributors` is **retained reference state shared across
  calculation versions** — a row written during an unfinished build would
  survive aborts as an unreferenced identity row: durable identity for a
  contributor that may end up represented nowhere. Revision-1 of this
  document allowed exactly that; corrected in §4.4/§5.
- `ownership_snapshots` monthly rows are immutable period facts; using them
  as accumulators forces dummy `contributor_id` values → same problem.
- `active_version` gating prevents *serving* partials, but the problem here
  is *storing* identity, not *serving* it.

**Rejected on privacy, retention, and schema-fit grounds.**

### 4.4 Option D — dedicated ephemeral working state (RECOMMENDED)

**Two** narrow ephemeral relations — not one. A single wide table would
either duplicate identity fields into every month row or conflate counters
with identity staging; the normalized pair is the cleaner privacy boundary:

**`ownership_history_work`** — accumulation counters only:

| Column | Why it is necessary |
|---|---|
| `user_id`, `repository_id` | tenant composite FK → cascade deletes |
| `scope_id` | composite FK `(scope_id, repository_id) → ownership_scopes`; file paths never appear |
| `calculation_version` | isolates build N+1 work from served N; enables failed-build GC |
| `period_start` | month key — the aggregation grain |
| `work_key` | `contributor_key`, or the literal `'unlinked'` for the single unresolved bucket; CHECK `work_key='unlinked' or work_key ~ '^[0-9a-f]{64}$'` makes the classes structurally disjoint |
| `is_bot` | boolean only — `human_contributor_count` needs the bot bit for **every** linked contributor including overflow-only ones, whose login is never persisted |
| `touch_commits` | the accumulated count — the point of the table |
| `first_seen_at`, `last_seen_at` | min/max `committedDate` within the month — preserves exact durable-candidate timestamps |
| `created_at`, `updated_at` | required for the concrete stale-work sweep (§7) |

**`ownership_contributor_build_work`** — **build-level** contributor
staging, one row per **represented key per repository build**, grain
`(repository_id, calculation_version, work_key)`:

| Column | Why it is necessary |
|---|---|
| `user_id`, `repository_id`, `calculation_version` | tenant boundary + build isolation — the grain is the *build*, not the scope |
| `work_key` | which represented contributor this stages |
| `github_node_id`, `display_login` | the identity pair rediscovered by pass 2 — populated only for represented keys |
| `is_bot` | the **frozen pass-1** classification — recorded once, verified on every later appearance (§5.3); the retained row's value comes from here, never from pass-2 observations |
| `first_seen_at`, `last_seen_at` | merged represented-scope bounds, accumulated by scope COMMITs via least/greatest (§5.4) |
| `created_at`, `updated_at` | stale-sweep requirement (§7) |

Why build-level, not scope-level staging (revision-3 change):
`ownership_contributors` is **shared across calculation versions** — the
deployed `dash_ownership_*` RPCs filter snapshots by `active_version` but
join `display_login`/`is_bot` from the shared contributor row
unversioned. Any build-time mutation of a shared contributor row
(display_login refresh, is_bot, seen bounds) would therefore leak N+1
metadata into live active-N responses, and an abort could not restore the
old values. The build-level row is the complete intended N+1 contributor
metadata; retained rows are **never mutated while a building version
exists** — promotion applies it atomically (§5.7).

Hard rules for the staging relation:

- **only represented keys may ever appear** — the resolve page tx writes a
  staged row only when `work_key ∈ represented`(recomputed from the
  completed accumulation counters); overflow keys observed during pass 2
  are classified transiently and discarded in memory;
- no email, no name, no `databaseId`, no path, no raw nodes;
- EPHEMERAL: backup-excluded, RLS zero-policy, `service_role` only, cascade
  on repo/user delete;
- deleted on promotion (consumed), on abort, and by the abandoned-build
  sweep;
- **it is the only place GitHub identity fields may exist outside retained
  tables — and only for already-represented contributors.**

Hard rules for the staging relation:

- **only represented keys may ever appear** — the resolve page tx writes a
  staged row only when `work_key ∈ represented(set recomputed from
  accumulation counters)`; overflow keys observed during pass 2 are
  classified transiently and discarded in memory;
- no email, no name, no `databaseId`, no path, no raw nodes;
- EPHEMERAL: backup-excluded, RLS zero-policy, `service_role` only, cascade
  on repo/user delete;
- deleted by the promotion transaction that consumes it (§5.7), by the
  abort transaction (§5.6), and by the abandoned-build sweep — it lives
  for the whole build, not one scope;
- **it is the only place GitHub identity fields may exist outside retained
  tables — and only for already-represented contributors.**

**Migration 013 therefore needs two work relations.** One table would be
smaller only by conflating two data classes with different sensitivity;
the split keeps the counter relation identity-free *by shape*.

---

## 5. Recommended architecture

**Option D + scope-sequential processing + per-scope two-pass identity
resolution + atomic page checkpoints + pinned-revision walks.**

### 5.1 The attribution-freeze rule

**ACCUMULATE defines the build's attribution metrics.** Once a scope's
accumulate walk completes, the counters freeze:

- the set of work keys, per-month touch counts, unlinked share,
  Top-25 membership, `human_contributor_count`, and **`is_bot`
  classification** — frozen because `human_contributor_count` depends on
  it; the retained `ownership_contributors.is_bot` comes from the frozen
  pass-1 value staged in `ownership_contributor_build_work` — applied to
  the shared row only at promotion (§5.7), never from a pass-2
  observation and never during the build.

RESOLVE **must not mutate those metrics.** It exists solely to rediscover
`id`/`login` for keys pass 1 already proved individually represented. Any
GitHub-side linkage change during the build cannot alter the computed
aggregates — the build either resolves every required key and finalizes,
or fails closed and restarts the scope from a fresh ACCUMULATE (§5.3).

### 5.2 Build state machine

`ownership_sync_state` (unchanged columns; `history_cursor` jsonb carries
all checkpoint detail):

```
pending → history → done | error        (phase enum — unchanged)
```

`history_cursor` jsonb during `history` — deliberately small:

```jsonc
{
  "pinned_oid": "<40-hex>",                          // build boundary, §10
  "current": {
    "scope_id": "<uuid>",
    "pass": "accumulate" | "resolve",
    "accumulate_done": true,
    "cursor": "<graphql endCursor>" | null
  },
  "lease": { "owner": "<worker uuid>", "expires": "<ts>" },   // §14
  "build_started_at": "<ts>"
}
```

Scope order is **not** stored here: `pending_scopes` (existing jsonb
column) holds remaining scope ids, and deterministic order is re-derivable
from `ownership_scopes` (`order by depth, scope_path_hash`) at any resume
point — no duplicated full-scope list in the cursor. Worst-case
`history_cursor` stays ~1 KB; `pending_scopes` carries the ≤500 uuid list
(~20 KB) honestly, once, where the column was designed for it.

`blame_cursor` untouched — HEAD blame is a later tranche.

### 5.3 Per-scope lifecycle

Repo scope first — its resolve pass stages the bulk of identities once.

```
ACCUMULATE   walk history(pinned_oid, path=scope) page by page;
             each page → own_checkpoint_page CAS tx with p_deltas
             until hasNextPage=false → accumulate_done=true
RESOLVE      re-walk the same scope's pinned history (pass 2);
             per page, the SAME CAS primitive with p_identities:
             recompute work_key for each node; for keys in the
             represented set (recomputed deterministically from the
             completed accumulation counters each invocation):
               - verify observed is_bot(current login) == frozen
                 build-level is_bot — mismatch is classification
                 drift → fail closed
               - upsert {work_key → node_id, login} into
                 ownership_contributor_build_work (repo×version grain);
                 a conflicting stored node_id for the same key is
                 impossible by construction and fails closed if seen;
             skipped entirely when every represented key is staged
COMMIT       ONE transaction — the only place retained rows are written:
             1. verify accumulation complete for the scope
             2. verify a staged build-work row exists for EVERY
                represented linked key (missing → abort → restart
                scope at fresh ACCUMULATE)
             3. merge this scope's contribution into the build-work row:
                is_bot must equal the staged frozen value (drift →
                fail closed); first/last seen merge via least/greatest
             4. NEW represented contributor (no ownership_contributors
                row): insert the minimum legitimate linked row —
                node_id + display_login + frozen is_bot + staged
                first/last — required so building snapshots can FK to
                it. It is invisible to active-N RPC output because no
                active-version snapshot references it; abort prunes it
                (§5.6).
                EXISTING contributor row: reference its existing id in
                building snapshots — update NOTHING on it (no
                display_login / is_bot / first_seen_at / last_seen_at
                writes while building_version is incomplete).
             5. materialize monthly contributor snapshot rows +
                scope-total snapshot rows (building_version)
             6. delete the scope's ownership_history_work rows
             7. mark scope done: advance pending_scopes, clear current
```

A COMMIT that fails writes nothing retained: no contributor identity, no
snapshots — ephemeral state persists for safe retry. A retry re-enters at
step 1 with the same checks. New contributor rows created by a committed
scope COMMIT are *building artifacts*: they exist solely so building
snapshots have a valid FK target, no active-N snapshot references them,
and the abort transaction removes them via the unreferenced-row prune —
their presence is not evidence that active N changed.

**Resolve-drift semantics (corrected):** `author.user` is resolved by
GitHub at query time and can change independently of the pinned commit —
a pass-1 linked contributor can return `user = null` in pass 2. The
revision-1 "fold into unlinked" policy was **removed as unimplementable**:
a null `author.user` carries no node id, so there is no way to map the
null observation back to the earlier `work_key`, and the history query
deliberately selects no per-commit identity that could perform that
mapping. Semantics now:

- a required represented key that cannot be resolved by the end of the
  complete pass-2 walk → the scope/build **fails closed** and restarts
  from a fresh ACCUMULATE (bounded retries, then
  `OWNERSHIP_HISTORY_FAILED`);
- a *new* linked key appearing only in pass 2 is **ignored** for this
  build — it was not in pass 1's represented set and contributes nothing
  the freeze didn't already count;
- an overflow key disappearing in pass 2 is irrelevant — overflow
  contributes only counts, which are frozen;
- a login rename under the same node id that **preserves bot
  classification** is a valid refresh — pass-2 stage captures the current
  login, which is the correct durable display value;
- a login change under the same node id that **flips bot
  classification** (ordinary login → `[bot]`-suffixed, or vice versa) is
  classification drift: the frozen `is_bot` is part of the attribution
  metrics, so the scope **fails closed and restarts at a fresh
  ACCUMULATE** — bounded retries, then `OWNERSHIP_HISTORY_FAILED`. Pass 2
  may never silently alter bot classification;
- **cross-scope bot consistency:** `is_bot` for a `work_key` is frozen
  once per build at first representation. If a later scope's pass-1
  classification for the same key disagrees with the frozen build-level
  value, the identity classification changed mid-build → **fail/restart
  the repository build from a new pinned boundary**, not just the scope.
  One contributor cannot be human in one scope and bot in another within
  a single calculation version.

### 5.4 first_seen_at / last_seen_at — corrected semantics

Work rows keep min/max `committedDate` per (scope, key, month). At scope
COMMIT, for each represented contributor:

```
current_scope_first = min(first_seen_at over that key's CURRENT-scope work rows)
current_scope_last  = max(last_seen_at  over that key's CURRENT-scope work rows)
```

then the **build-level staging row** — never the shared retained row —
merges:

```
staged.first_seen_at = least(staged.first_seen_at, current_scope_first)
staged.last_seen_at  = greatest(staged.last_seen_at, current_scope_last)
```

So the build's intended first/last bounds accumulate **only across
finalized scopes in which the contributor was individually represented**.
Activity observed in an earlier scope where the contributor stayed
overflow-only does **not** contribute — those work rows are destroyed at
that scope's COMMIT, and no claim can be made about them. The staged
bounds land on the shared retained row only inside the promotion
transaction (§5.7). The spec §27 amendment states this so the field names
never imply an all-repository-touch guarantee the storage model cannot
provide.

### 5.5 Unlinked and bots

All `author.user == null` nodes accumulate into `work_key='unlinked'` —
one bucket, no per-author keys, no name/email ever touched. Malformed
present-but-broken identity → `OwnershipIdentityError` → page tx aborts →
cursor doesn't advance → `OWNERSHIP_HISTORY_FAILED` fail-closed; the walk
wedges at that cursor for an operator decision rather than silently
reclassifying. `is_bot` travels on the work row as a bare boolean — the
only way `human_contributor_count` can include/exclude overflow
contributors exactly without their logins.

### 5.6 Build abandonment — THE canonical cleanup operation

Scope COMMITs legitimately create `ownership_contributors` rows (for
contributors new to the repository, §5.3) and `building_version`
snapshots before the build completes. If the build is abandoned before
promotion, those rows must not orphan — this is identity minimization,
not housekeeping.

Crucially, **existing contributor rows referenced by active N require no
save/restore** — under this design they are never mutated during the N+1
build (§5.7), so there is nothing to roll back. This is a stronger
invariant than save/restore: the shared row cannot drift in the first
place.

**The canonical abandon transaction** (`own_abandon_build`, prospective
013 — the ONE semantic abandon operation; the stale-build sweep, restore
reconciliation, operator abort, and invalid-state recovery all reuse it —
there is no second cleanup semantics anywhere):

1. `SELECT FOR UPDATE` the `(user_id, repository_id)` sync-state row.
2. Verify `building_version = V` (the expected version is supplied).
3. Delete `ownership_snapshots` where `repository_id` and
   `calculation_version = V`.
4. Delete `ownership_history_work` and `ownership_contributor_build_work`
   for that repo/version.
5. Clear `building_version`, `history_cursor` build state, and
   `pending_scopes` for the build.
6. **Prune** `ownership_contributors` rows for the repository referenced
   by *zero* `ownership_snapshots` rows across *all* versions — the
   anti-join is what makes it safe: N-referenced contributors survive;
   V-only rows created solely to satisfy building-snapshot FKs are
   removed. Synthetic `unlinked`/`other` rows prune the same way — they
   are reconstructable.
7. `active_version` is never touched; phase/error fall back to the state
   implied by whether an active version exists (closed taxonomy only).
   Existing contributor metadata needs no restoration — it was never
   mutated.

### 5.6a The ephemeral-loss invariant (CANONICAL)

`ownership_contributor_build_work` accumulates metadata across
**already-finalized** scopes of the building version — staged
`display_login`, the frozen build-level `is_bot`, and represented-scope
seen bounds exist nowhere else (`ownership_snapshots` does not carry
them). Therefore:

> **If `building_version` is non-null and any required EPHEMERAL build
> state is lost, stale, corrupt, or deliberately discarded, the ENTIRE
> building version is invalid. It must never resume piecemeal — not even
> "restart the current scope." The only safe operation is the canonical
> abandon transaction, then a fresh build later from a fresh pinned
> boundary. No previously committed V scope is trusted.**

A new repository build may not start while `building_version` is set: it
first **resumes** the existing build if §5.6b validity holds, else runs
`own_abandon_build`. `building_version` must be null before a fresh build
initializes — no overlapping building versions, ever.

### 5.6b Required ephemeral-state validity

Whether a build is resumable is decided by internal consistency, not by
the mere presence/absence of counter rows:

| State-machine position | Required present | Allowed absent |
|---|---|---|
| ACCUMULATE mid-scope | `history_work` prefix rows may exist (or be empty pre-first-page); `contributor_build_work` for previously finalized scopes' represented keys | next pages |
| RESOLVE mid-scope | complete `history_work` counters for the scope; `contributor_build_work` for prior scopes | identity rows not yet observed in pass 2 |
| Between scopes | `contributor_build_work` for all represented keys of committed scopes; `pending_scopes` non-empty | `history_work` for the just-committed scope (consumed) |
| Ready to promote | `pending_scopes` empty; complete `contributor_build_work`; zero `history_work` | — |

Zero `history_work` rows is **not** evidence of loss — it is the legal
state after each scope COMMIT and before promotion. Validation checks:
`building_version` non-null, phase/pass/current-scope consistent with
`history_cursor`, `pending_scopes` well-formed, every represented key of
every already-committed scope having a `contributor_build_work` row, and
no orphaned V snapshots without their staging. If any check fails — never
reconstruct heuristically → `own_abandon_build`.

### 5.7 Promotion — atomic metadata application + version flip

When `pending_scopes` is empty, ONE transaction under the sync-row lock:

1. Verify: `building_version = V`; no `ownership_history_work` rows for V;
   no unresolved `ownership_contributor_build_work` rows for V (every
   represented key has a complete staged identity); snapshot cardinality
   within §11 bounds.
2. Apply staged contributor metadata to retained rows —
   `UPDATE ownership_contributors ... FROM ownership_contributor_build_work`
   setting `github_node_id` (consistency-checked: same `work_key` must
   carry the same node id — mismatch fails closed), `display_login`,
   `is_bot` (the frozen pass-1 value), `first_seen_at`, `last_seen_at`.
   New contributors inserted at scope COMMITs already carry these values;
   the update is idempotent over them.
3. `active_version = V; building_version = null;` clear build cursor state;
   `phase = 'done'` — single row update.
4. Delete `ownership_contributor_build_work` for the repo/version.
5. Commit.

The metadata application and the `active_version` flip are visible
**together**: before this transaction, active-N responses can only read
the old contributor metadata; after it, they read N+1 snapshots joined to
the new metadata. No intermediate mixed state is observable — readers
under read-committed see either fully-pre or fully-post commit. A failed
promotion leaves active N and all shared contributor metadata unchanged
and building V retryable. Post-flip garbage collection of old-version
snapshots is a separate later transaction (spec §13) and can prune
contributors left unreferenced by that GC the same way §5.6 does.

### 5.8 Why this is required — the shared-metadata leak

The deployed `dash_ownership_head` / `dash_ownership_timeline` RPCs
(`012_ownership.sql`) filter `ownership_snapshots` by
`calculation_version = st.active_version` but join `display_login` /
`is_bot` from `ownership_contributors` **without any version column to
filter on** — the contributor row is shared reference state by design.
Any in-build UPDATE of `display_login`, `is_bot`, or the seen bounds on a
contributor also referenced by active N would immediately alter live
active-N responses — and, being unversioned, could not be restored by the
abort anti-join prune. Revision-2's scope-level staging still wrote the
final metadata at scope COMMIT, which had exactly this defect. The
build-level relation + promotion-time application is the fix.

Required implementation-time tests:

- **Initial-build abort:** `active_version=null`, some V1 scopes
  committed → abort → zero V1 snapshots, zero V1-only contributor rows,
  zero rows in both work relations.
- **N → N+1 abort:** N active, some N+1 scopes committed → abort → all N
  rows untouched (snapshots *and* contributor metadata byte-identical);
  contributors referenced by N survive; contributors introduced only by
  N+1 pruned; no N+1 snapshots or work rows remain.

---

## 6. Exactly-once checkpointing

### 6.1 The primitive — `own_checkpoint_page` (prospective 013 function)

A SQL function, `security invoker`, `EXECUTE → service_role` only:

```
p_user, p_repository, p_version, p_scope, p_pass,
p_expected_cursor, p_next_cursor,
p_deltas jsonb        -- accumulate: [{period_start, work_key, is_bot,
                      --   touches, first_seen_at, last_seen_at}]
p_identities jsonb    -- resolve: [{work_key, github_node_id,
                      --   display_login, observed_is_bot}]
```

One transaction, in order:

1. `SELECT ... FROM ownership_sync_state WHERE (user_id, repository_id)
   FOR UPDATE` — serializes all ownership work for the repo.
2. Verify: row exists, `building_version = p_version`, `phase='history'`,
   `current.scope_id = p_scope`, `current.pass = p_pass`,
   `current.cursor IS NOT DISTINCT FROM p_expected_cursor`.
3. On any mismatch → `RETURN 'stale'` — **no writes.**
4. Apply `p_deltas`: set-valued upsert into `ownership_history_work`
   `ON CONFLICT (scope_id, calculation_version, period_start, work_key)
   DO UPDATE SET touch_commits = w.touch_commits + EXCLUDED.touch_commits,
   first_seen_at = least(...), last_seen_at = greatest(...)`; cap check in
   the same statement (§7 bounds → raise → caller marks error).
   Apply `p_identities`: `INSERT ... ON CONFLICT DO UPDATE` into
   `ownership_contributor_build_work` at `(repository_id,
   calculation_version, work_key)` grain — **staged** rows only, never
   `ownership_contributors`. Each staged row's `is_bot` is written from
   the **frozen pass-1** counters (not the pass-2 observation); if
   `observed_is_bot` differs from the frozen value the transaction raises
   — classification drift fails the scope closed (§5.3). A conflicting
   stored `github_node_id` for an existing `work_key` is impossible by
   construction and also fails closed.
5. `jsonb_set(history_cursor, '{current,cursor}', p_next_cursor)` and, when
   `hasNextPage` was false, set `accumulate_done` / flip `pass`.
6. Commit.

### 6.2 Proof of the two crash windows

**Invariant:** durable work state for scope S under version V always
reflects exactly the prefix of pages ending at durable cursor C — in both
work relations.

- Inductive step: a transaction either aborts entirely (state = prefix at
  C, cursor still C — CASE B impossible: cursor cannot move without its
  deltas) or commits (state = prefix at C′, cursor C′ — CASE A impossible:
  deltas cannot land without the cursor moving). Atomicity makes the
  intermediate state unobservable. ∎
- Retry after commit-with-lost-response: caller retries with
  `p_expected_cursor = C`; stored cursor is C′ ≠ C → step 2 fails →
  `'stale'`, zero writes. The page applied exactly once. ∎
- Additive `+ delta` upserts are safe **only because** the CAS guarantees a
  delta batch applies at most once per cursor value — the rejected
  "write then advance" / "advance then write" orderings are exactly
  CASE A / CASE B.

The same CAS envelope protects COMMIT (expected "scope still current" +
accumulate/resolve-complete checks inside the transaction) and promotion
(expected "pending empty, no work rows for version") — one mechanism
everywhere.

---

## 7. Working-state bounds, TTL, and cleanup

Work rows exist only for the scope currently in `ACCUMULATE`/`RESOLVE`;
COMMIT deletes them before the next scope starts.

| Bound | Limit | Rationale |
|---|---|---|
| Distinct `work_key` per scope | 10,000 | ~5× facebook/react's repo-wide contributor count for a *single* scope |
| Accumulation rows per scope | 100,000 | keys × active months; ~10 MB transient worst case |
| Build-work rows per build | ≤ represented keys, ≤10,000 | one row per represented key across the whole build — the narrowest possible set |
| Page delta rows | ≤100 | one GraphQL page |

Breach → `phase='error'`, `error='OWNERSHIP_INTERNAL_ERROR'` — **never**
silently partial; an over-cap scope is an error, not a folded result.

**Cleanup — concrete, and routed through the canonical abandon:**

- Rows carry `created_at`/`updated_at`; the checkpoint upsert touches
  `updated_at` on every application, so **activity is directly visible on
  the rows themselves.**
- **Stale threshold:** a repository build showing no checkpoint for
  **14 days** (no valid lease; row `updated_at` and
  `ownership_sync_state.updated_at` both older) is abandoned. Two weeks
  is far beyond any legitimate pause — slices checkpoint every ~40 s
  while a build lives.
- **A stale build is never cleaned piecemeal.** `own_sweep_stale_work`
  must NOT bare-`DELETE` work rows for a repo whose `building_version`
  is still set — that would strand V's snapshots and V-only contributors.
  Under the sync-row lock it verifies `building_version = V` and genuine
  staleness, then runs `own_abandon_build` (§5.6) — the identical
  delete/prune/clear sequence. Only **orphan rows with no
  `building_version`** (e.g. leftovers of an already-cleared build) may
  be deleted directly.
- **Active-build protection:** a build checkpointing within the window is
  by definition not stale — the threshold only fires on genuinely dead
  state.
- **Sweep triggers:** (a) at every build start for that repo — validity
  check §5.6b → resume or `own_abandon_build`; (b) a periodic sweep
  function (`own_sweep_stale_work`, proposed in 013) invoked by whatever
  scheduler the implementation tranche wires — so cleanup eventually runs
  even if the repo never builds again; (c) unconditional FK cascade on
  repository/account deletion.
- **Error-build behavior:** `phase='error'` leaves build state for
  operator inspection (backup-excluded and bounded) until the 14-day
  sweep runs the abandon path or the next build start does.
- **Gate-off behavior:** identical — no caller runs, rows age out via the
  sweep; no special case needed.

---

## 8. Required contract amendment (proposed, not live)

Recorded in the spec appendix as PROPOSED — effective only if the
implementation tranche is approved:

1. **New data class — EPHEMERAL short-lived persisted operational state:**
   (a) per (scope × month × work_key) counters + `is_bot` + min/max
   committedDate; (b) per represented-key identity staging
   (`work_key`, `github_node_id`, `display_login`, frozen `is_bot`,
   `first_seen_at`, `last_seen_at`) at **repository-build** grain —
   `ownership_contributor_build_work`, grain `(repository_id,
   calculation_version, work_key)` — existing only while a building
   version exists. `work_key` is a repo-scoped pseudonymous identifier —
   permitted persisted only under the §3 conditions.
2. **§6.4 preserved verbatim** — overflow contributors get no retained
   identity row and their GitHub identity fields never reach any
   persisted state; staged build-work rows exist only for contributor
   keys pass 1 already proved individually represented.
   **Version isolation:** shared `ownership_contributors` rows are never
   mutated while a `building_version` is incomplete — the dashboard RPCs
   join contributor metadata unversioned, so any mid-build metadata write
   would leak into active-version responses (§5.8). Intended N+1
   metadata lives in build staging and is applied in the **same
   transaction** as the `active_version` flip. A scope COMMIT may create
   a *new* contributor row solely to satisfy building-snapshot FKs —
   invisible to active-N output (no N snapshot references it) and pruned
   by the abort path if unreferenced.
   **Attribution freeze:** `is_bot` is frozen by pass 1 along with all
   counts; pass 2 verifies rather than re-derives it, and a mismatch —
   between passes *or across scopes of one build* — fails the build
   closed rather than silently reclassifying.
   **Abort cleanup:** abandoned builds delete their versioned snapshots
   and ephemeral state, then prune `ownership_contributors` rows
   unreferenced by any snapshot in any version — retained-version
   contributors always survive (§5.6); their metadata was never mutated,
   so nothing needs restoration.
   **Seen-at semantics:** retained `first_seen_at`/`last_seen_at`
   accumulate only across finalized scopes where the contributor was
   individually represented (§5.4) — no all-repository-touch claim.
3. **Second persisted SHA** — `history_cursor.pinned_oid` joins
   `last_processed_sha` as a sanctioned SHA (build boundary vs
   incremental anchor).
4. **Two-pass re-derivation** — `author.user.{id,login}` may be re-read
   in a resolve pass solely to stage identities for represented keys.

Nothing else changes: no new identity fields, no finer granularity, no
relaxation of §5's prohibited list.

---

## 9. Backups & restore

- Both work relations → **EPHEMERAL** in `backup-scope.mjs`
  (classification is mandatory — an unclassified table fails CI).
  Verified against the revision-3 state model: losing them never loses
  active user data — the recovery cost is **"discard the incomplete
  building version and rebuild it,"** not "resume the current scope."
  Dumping them would persist pseudonymous state for zero benefit; the
  EPHEMERAL classification stands.
- **Restore semantics — abandon, never piecemeal-resume:** restore
  returns `ownership_sync_state` (OPERATIONAL) but no work rows. If the
  restored row has `building_version = V`, the required build state for V
  is by definition absent/incomplete → V is unrecoverable → run
  `own_abandon_build`: delete V snapshots, delete any surviving V work
  rows, prune unreferenced V-only contributors, clear V build state. Then
  a later ownership run begins a NEW complete build — re-enumerate
  scopes, obtain a fresh pinned revision, accumulate from the start; **no
  previously committed V scope is trusted.**
  - *Initial V1 restore* (`active_version=null`, partial V1): remove all
    V1 artifacts → repo returns to "ownership not ready" → a fresh V1
    build starts later.
  - *N active + N+1 building restore:* remove all partial N+1 artifacts →
    N stays byte-identical and active → a fresh N+1 build starts later.
  - `active_version` is untouched in both cases — every active row comes
    from CORE tables (`ownership_scopes`, `ownership_contributors`,
    `ownership_snapshots` at N, `ownership_sync_state`).

---

## 10. Revision pinning — the second blocker

`defaultBranchRef.target` resolves **at query time**: page 1 can read
HEAD@A and page 40 HEAD@B after a push — silently mixing revisions inside
one scope's aggregates.

**Design:** resolve `defaultBranchRef.target.oid` once at build start
(cost-1 probe) → `pinned_oid` in `history_cursor` → every walk uses:

```graphql
repository(owner: $owner, name: $name) {
  object(oid: $oid) {
    ... on Commit {
      history(first: 100, path: $path, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { committedDate author { user { id login } } }
      }
    }
  }
}
```

Tree enumeration likewise pins: `object(oid:)` → `... on Commit { tree
{ oid } }` then REST `git/trees/{tree_sha}?recursive=1` — the measured
endpoint form, now sha-pinned.

- Retries always carry `pinned_oid` — same revision by construction.
- Force-push making the oid unresolvable → fail closed
  (`OWNERSHIP_HISTORY_FAILED`), `active_version` kept, next build re-pins.
  Never continue mid-build on a new HEAD — that mixes revisions.
- GitHub's GraphQL schema does expose `Repository.object(oid:)` — but the
  **exact ownership query shape is UNMEASURED.** Phase 0.5 used
  `object(expression:"HEAD")` for blame only.
- **Gate: Phase 1C-B0.5 non-persisting spike** before implementation —
  metadata-only queries, no writes — measuring:
  `object(oid:) → Commit → history(path:)`; multi-page cursor stability;
  the same pinned oid across repeated requests; public **and** private
  repos; unreachable-oid behavior (`null` vs `NOT_FOUND` error);
  force-push/deleted-reference behavior if safely reproducible; GraphQL
  cost; `tree.oid` from the pinned Commit; the REST recursive tree call
  with that exact tree sha; and `author.user` resolution behavior under a
  pinned commit.

---

## 11. Prospective migration 013 (DO NOT CREATE)

`013_ownership_checkpointing.sql` — additive only:

- `create table public.ownership_history_work` — §4.4 columns; composite
  FKs `(repository_id, user_id) → repositories` and
  `(scope_id, repository_id) → ownership_scopes(id, repository_id)`, all
  `on delete cascade`; unique `(scope_id, calculation_version,
  period_start, work_key)`; CHECKs on work_key shape, non-negative
  counts, `calculation_version > 0`, first ≤ last seen.
- `create table public.ownership_contributor_build_work` — §4.4 columns:
  tenant/version + `work_key` + `github_node_id` + `display_login` +
  frozen `is_bot` + `first_seen_at`/`last_seen_at` + timestamps;
  composite tenant FK `(repository_id, user_id) → repositories`; unique
  `(repository_id, calculation_version, work_key)`; CHECK work_key is a
  64-hex key (never `'unlinked'`/`'other'` — synthetic buckets carry no
  identity and must never be staged).
- RLS enabled, zero policies; revoke browser roles; `service_role` DML
  only — on **both**.
- `own_checkpoint_page(...)` — §6.1; `security invoker`, `EXECUTE →
  service_role`, all other grants revoked. The same transactional pattern
  covers scope-COMMIT (§5.3) and promotion (§5.7) — whether as additional
  functions or a client-managed multi-statement tx is an implementation
  detail of 1C-B.
- `own_abandon_build(p_user, p_repository, p_version)` — **the canonical
  build-abandonment primitive** (§5.6): locks the sync-state row,
  validates the expected `building_version`, deletes the version's
  snapshots and both ephemeral relations, anti-join prunes unreferenced
  contributors, clears build state, preserves `active_version`. There is
  ONE semantic abandon operation — the stale sweep, restore
  reconciliation, operator abort, and invalid-state recovery all call it.
- `own_sweep_stale_work(...)` — repository-build-aware: bare-deletes
  orphan work rows only when `building_version` is null; for a genuinely
  stale live build (no lease, no activity in 14 days) it calls
  `own_abandon_build` — same security shape.
- `backup-scope.mjs`: append both tables to `EPHEMERAL_TABLES` (same PR —
  CI requires classification).
- Recovery-drill addition: assert the tables exist post-migration and are
  absent from dumps.
- No changes to the four existing tables: `phase` enum already contains
  `history`; resolve is cursor-jsonb state, not a new phase; the error
  taxonomy already covers every failure mode in §13.

---

## 12. Differential correctness test (design)

`test/ownership-checkpoint-equivalence.test.mjs` (Phase 1C-B deliverable):

- **Harness:** one synthetic node stream per scope →
  (A) `reduceHistoryToMonthly` once → expected output.
  (B) simulated engine: partition into pages; drive the checkpoint
  algorithm with an in-memory stand-in implementing identical upsert/CAS
  semantics → finalize → actual output.
- **Equivalence rule:** pass-2 is **metadata resolution only** — it may
  stage identity triples; it may not touch counts. Assert equality on:
  per-month `total_touch_commits`, per-contributor `touch_commits` /
  `touch_share`, `human_contributor_count`, `unlinked_touch_share`,
  exact Top-25 key sets, `other` counts/shares, and the durable
  `contributor_candidates` set including `first_seen_at`/`last_seen_at`.
- **Adversarial pagination:** month spanning many pages; boundary
  splitting a month mid-run; contributor crossing rank 25 on the final
  page; 30-way tie straddling rank 25; unlinked/bot nodes across pages;
  replay of a committed page (must no-op via stale cursor);
  commit-success/response-lost; timeout between pages.
- **Resolve-stage failure cases:**
  - selected represented key resolves to `user=null` during resolve →
    fail closed, restart scope at fresh ACCUMULATE;
  - selected key never re-observed in pass 2 → same fail/restart;
  - overflow key disappears during resolve → ignored, aggregates frozen;
  - new linked key appearing only in resolve → ignored this build (next
    fresh build may observe it);
  - login rename under same node id preserving bot classification →
    staged login refreshes correctly;
  - same node id, ordinary login → `[bot]` login between passes → fail
    closed, restart at fresh ACCUMULATE;
  - same node id, `[bot]` → ordinary login between passes → same
    fail/restart;
  - identical bot classification between passes → valid;
  - resolve completes, worker crashes before COMMIT → **zero** durable
    contributor rows from that scope — staged rows stay ephemeral and the
    next attempt re-verifies them inside the same COMMIT transaction;
  - the retained `is_bot` on every contributor row equals the pass-1
    frozen value, never a pass-2 observation.
- **Candidate/upsert equivalence:** the contributor candidate set and
  each candidate's `first_seen_at`/`last_seen_at` must equal the one-shot
  result, with the documented merge rule — bounds accumulate only over
  scopes where the contributor was individually represented (§5.4), and
  the simulated multi-scope run must exercise the least/greatest merge
  into the build-level staging row.
- **Abort cases:** initial-build abort leaves zero V1 snapshots,
  zero V1-only contributor rows, zero work/staging rows; N→N+1 abort
  preserves all N rows and N-referenced contributors while pruning
  N+1-only contributors (§5.6).
- **Version isolation (§5.7/§5.8):**
  - N active + N+1 scope committed: N+1 snapshots exist, but the
    active-version RPC output is byte-identical — existing contributors'
    `display_login`, `is_bot`, `first/last_seen_at` unchanged;
  - N+1 abort: N snapshots and N contributor metadata unchanged, N+1
    snapshots gone, N+1-only contributors pruned, all build staging gone;
  - N+1 promotion: staged metadata application and the `active_version`
    flip commit in one transaction — post-promotion responses show N+1
    snapshots + new metadata, no observable intermediate mix;
  - database error mid-promotion: active N and its contributor metadata
    untouched, building N+1 fully retryable;
  - contributor represented across several N+1 scopes: build-level
    staged bounds aggregate all represented scopes correctly while the
    shared row stays unchanged until promotion.

---

## 13. Failure matrix

| Case | Durable state | Retried? | No double-count | No skip | Cleanup |
|---|---|---|---|---|---|
| Crash before GitHub response | cursor=C, state=prefix(C) | yes, refetch | page never applied | cursor still C | — |
| Crash after response, before tx | same | yes | tx never ran | same | — |
| Tx commits, response lost | cursor=C′, state=prefix(C′) | retry sees C′≠C → 'stale' | CAS rejects re-apply | applied | — |
| Retry same page | — | 'stale' | no writes on stale | — | — |
| Rate limit before page | unchanged | resume from C | nothing applied | — | `GITHUB_RATE_LIMIT`, resume later |
| Rate limit after response | response in hand → tx completes or aborts clean | — | tx atomic | — | — |
| Malformed identity in page | tx aborts; cursor stays C | wedges → fail closed | — | page never committed | `OWNERSHIP_HISTORY_FAILED` |
| DB timeout before commit | abort | retry applies | — | — | — |
| DB timeout, unknown outcome | maybe committed | retry: C′ → 'stale' else apply | exactly-once either way | — | — |
| Worker timeout | as crash cases | next worker | CAS | — | lease expiry §14 |
| Deploy during build | in-flight tx aborts or completes | next deploy resumes | CAS | — | additive 013 keeps reads compatible |
| Gate off mid-build | ephemeral rows idle | no caller runs | — | — | stale sweep → `own_abandon_build` / next enable |
| Repo disconnected mid-build | rows persist; calls stop at gate | no | — | — | resume on reconnect if §5.6b valid; else canonical abandon |
| **Stale TTL while N+1 building** | N+1 snapshots + staging exist; build dead ≥14d | n/a — whole V discarded | — | — | `own_abandon_build`: V snapshots+work gone, V-only contributors pruned, N untouched |
| **Restore: N+1 sync state, no ephemeral tables** | sync row claims building V; work/staging absent | **never piecemeal-resume** | — | — | `own_abandon_build` → fresh N+1 build later; N stays byte-identical |
| **Restore: initial V1, no ephemeral state** | partial V1 artifacts | never resume | — | — | V1 artifacts removed; `active_version=null` → "not ready"; fresh V1 later |
| **Orphan work rows, `building_version=null`** | rows without a live build | n/a | — | — | direct sweep delete permitted — no build semantics to preserve |
| **Corrupt/inconsistent ephemeral state** | violates §5.6b invariants | never reconstruct heuristically | — | — | `own_abandon_build` → fresh build |
| **New build requested while `building_version` set** | existing build state | resume iff §5.6b passes; else `own_abandon_build` first | — | — | `building_version=null` before new build initializes — no overlapping versions |
| Repo deleted mid-build | FK cascade removes work+staging+sync rows | n/a | — | — | cascade is total |
| Installation revoked | state intact | fails at next fetch | CAS | — | `GITHUB_ACCESS_REVOKED` |
| Pinned revision disappears | pages error; cursor=C | retry once → fail closed | partial scope state never served (building_version) | — | `OWNERSHIP_HISTORY_FAILED`; next build re-pins |
| Represented key unresolvable in pass 2 | staging incomplete | bounded retry → restart scope at fresh ACCUMULATE → `OWNERSHIP_HISTORY_FAILED` | — | — | scope restarts; stale staged rows deleted on restart/sweep |
| Pass-2 bot-classification drift | staging not written for that key | same fail-closed restart at fresh ACCUMULATE | frozen pass-1 `is_bot` is the only authority | — | scope restarts; staged rows deleted |
| Build abort after ≥1 scope COMMITs | committed scope snapshots + contributor rows for `building_version` | abandon tx (§5.6) | — | — | single tx: delete versioned snapshots + both work relations + clear build state |
| Abort cleanup, N active + N+1 building | N rows are served data | n/a — cleanup only touches N+1 | — | — | N snapshots and N-referenced contributors preserved; N+1 artifacts deleted |
| Orphan contributor pruning | contributor rows unreferenced by every version | part of abandon tx | — | — | anti-join delete — only rows unreferenced by ANY snapshot version are removed |
| Crash between resolve-done and COMMIT | staged rows persist, zero retained writes | COMMIT retries from stored state | — | — | staging is ephemeral until consumed |
| calculation_version changed | old-version rows orphaned | n/a | version-scoped unique keys | — | GC by version at next build / sweep |
| Stale concurrent worker | lease + CAS | loser gets 'stale' | CAS rejects second apply | — | lease takeover after expiry |
| CAS cursor mismatch | — | reload, refetch from durable C | — | — | — |
| COMMIT succeeds, response lost | scope marked done in same tx | retry sees scope advanced → 'stale' | single tx — no partial | scope already done | work rows deleted by that same tx |
| Promotion tx fails mid-flight | abort — no writes | retry re-runs promotion | single tx | — | building V retryable; active N untouched |
| Promotion commits, response lost | V promoted atomically | caller reload sees active_version=V | flip+metadata in one tx | — | staging already deleted by that tx |
| Cross-scope bot drift mid-build | staged frozen is_bot ≠ later scope's pass-1 value | fail closed → fresh build boundary | — | — | abort path cleans build state |
| Shared contributor metadata mutate attempt during build | **none — design forbids it** | n/a | retained rows are read-only during build | — | nothing to roll back (§5.8) |

---

## 14. Concurrency

- **Per-repo, not per-user.** `ownership_sync_state` is the contention
  unit — `user_sync` locking untouched, so a large ownership build can
  never starve the same user's normal sync.
- **Soft lease** (`history_cursor.lease = {owner, expires}`): a worker
  holds the build; an expired lease yields to takeover. Reduces wasted
  fetches; it is not the correctness mechanism.
- **Correctness backstop:** `SELECT FOR UPDATE` + cursor CAS inside the
  checkpoint primitive — two racing workers cannot double-apply even with
  racing leases.

---

## 15. Rate limit / slice budget

- ≤300 GraphQL pts per slice (spike recommendation — headroom for normal
  sync inside the 5,000 pt/hr floor).
- Wall-clock deadline ~40 s inside the 45 s slice; stop only at page
  boundaries — a checkpoint is the only legal pause point.
- Count **measured** `rateLimit.cost` per page, never assumed 1; stop
  when `remaining` < 500 or budget spent; rate limits surface only as the
  closed `GITHUB_RATE_LIMIT` error code.
- Resume: next scheduled slice picks up at the durable cursor (runtime
  wiring is Phase 1C-B's job, not this document's).

---

## 16. Decision standard — final answers

| Question | Answer | Basis |
|---|---|---|
| A. Buildable without migration 013? | **NO** | §1 — no existing table can hold per-contributor intermediate state within the contract |
| B. Temporary per-contributor state unavoidable? | **YES** | §0 — exact fold requires complete sets; multi-invocation walks lose memory |
| C. Fifth ephemeral table required? | **YES — two relations** | §4.4 — per-scope counters + build-level contributor staging are different data classes and different lifecycles |
| D. Two-pass identity resolution required? | **YES** | §5.1/§5.3 — the only way to keep overflow identity fields unpersisted while still populating durable contributor rows |
| E. Fixed-revision history query required? | **YES** | §10 — `defaultBranchRef` drifts mid-build |
| F. Additional measured spike required? | **YES** | §10 — `object(oid:)` history is unmeasured |
| G. Exact Top-25 preserved? | **YES** | §3 — work key = contributor key, identical comparator, frozen pass-1 metrics |
| H. Overflow identity fields unpersisted? | **YES** | §4.4 — staging accepts represented keys only; durable contributor rows exist only via COMMIT |
| I. Every page transition exactly-once? | **YES** | §6.2 — single-transaction CAS, proven |
| J. Work state backup-excludable safely? | **YES** | §9/§5.6a — loss = discarded *building* version (canonical abandon + fresh rebuild), never active user data |

## 17. Readiness verdict

**Ready to IMPLEMENT Phase 1C-B: NO.** Three prerequisites, in order:

1. Approval of the §8 contract amendment (ephemeral pseudonymous counters
   + represented-key identity staging + pinned build SHA).
2. Phase 1C-B0.5 non-persisting spike measuring pinned-revision history
   walks, pinned tree enumeration, and unreachable-oid behavior (§10).
3. Then: migration 013 + the engine implementation behind the existing
   hard-off gate.
