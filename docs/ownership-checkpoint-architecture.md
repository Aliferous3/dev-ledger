# Ownership Checkpoint Architecture — Phase 1C-B0 Design

> **Status: design only, revision 7. Nothing in this document is implemented
> or live.** Revision 6→7 hardening — **state integrity**: both retained
> child→base-scope FKs become `ON DELETE NO ACTION` in prospective 013
> (the existing `ownership_snapshots→ownership_scopes` CASCADE and the
> new `ownership_scope_versions→ownership_scopes` FK), so a referenced
> base scope is undeletable while teardown still cascades through the
> direct repository/user FKs; the FK action is named exactly — `NO
> ACTION`, checked after the statement's referential actions — never
> "NO ACTION/RESTRICT"; a retired-version GC gate (§5.6c) makes a third
> coexisting version impossible and the ≈≤1000 base-identity bound real;
> scope-restart staging cleanup (§5.3) is defined by committed-V
> provenance; promotion requires an *exact* staged↔represented key set
> (§5.7). Revision 5→6 — **membership integrity + cardinality
> precision**: `ownership_snapshots` gains a DB-enforced composite FK to
> `ownership_scope_versions` (same scope/repo/tenant/version; `NO ACTION`,
> so membership deletion can never destroy snapshots); the 500-directory
> hard enumeration cap is distinguished from the `cardinality_cap`
> analysis-omission marker; overflow directories are never persisted at all;
> bounds are stated per version (~≤1000 transient base identities during
> N/N+1 coexistence). Revision 4→5 — **scope version isolation**:
> `ownership_scopes` is shared/unversioned exactly like
> `ownership_contributors` — `dash_ownership_scopes` enumerates base scope
> rows regardless of version, so a building version's new scopes or
> exclusion-state mutations would leak into active-N responses. The design
> now splits immutable scope identity from versioned membership
> (`ownership_scope_versions`, CORE). Revision 3→4 — **ephemeral-loss
> semantics**: losing any required ephemeral state invalidates the ENTIRE
> building version; one canonical `own_abandon_build` reused by sweep,
> restore, abort, and invalid-state recovery. Revision 2→3 — **version
> isolation**: shared contributor rows never mutated during a build;
> metadata staged build-level, applied atomically at promotion. Earlier:
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
  re-walk the prefix → no completion guarantee (Option A fails, §4.1).
- Persist every contributor's identity provisionally → overflow GitHub
  identities reach storage → violates §6.4 durable-identity minimization
  and §9 "in memory only".

**Finding: there is no architecture that satisfies exactness, crash safety,
and identity minimization using only the four existing tables.** The minimum
amendment is: two ephemeral, backup-excluded work relations (counters plus
build-level identity staging); one retained versioned scope-membership
relation (`ownership_scope_versions`, CORE) with a **DB-enforced composite
FK from `ownership_snapshots`**; the canonical checkpoint/abandon/sweep
primitives; an atomic contributor-metadata promotion; and a version-correct
`dash_ownership_scopes`. §5 below; the required contract amendment is
recorded in §8 and in the spec's proposed-amendment appendix.

---

## 1. Fundamental verdict: four tables are NOT sufficient

Checked against `012_ownership.sql` as deployed:

| Candidate storage | Why it cannot carry work state |
|---|---|
| `ownership_snapshots` | Contributor rows require `contributor_id` → a durable `ownership_contributors` row → requires `github_node_id`/`display_login` non-null (`ownership_contributors_linked` CHECK). Overflow identities would be written. Also no month-keyed accumulation shape without polluting immutable period facts. |
| `ownership_contributors` | The linked CHECK **forces** `github_node_id` + `display_login` — pseudonym-only provisional rows are impossible by construction, and persisting identities there is exactly what §9.1 forbids. It is also **retained, version-shared reference state** — not scoped to `calculation_version` — so it cannot be used as build scratch space at all (§4.4). |
| `ownership_sync_state` (`history_cursor`/other jsonb) | Technically possible, rejected in §4.2: it is OPERATIONAL (dumped into backups — provisional pseudonyms would leak into every dump), a single JSONB row is a read-modify-write hotspot with unbounded growth, and it cannot be CHECK-constrained per element. |
| `ownership_scopes` | Scope definition only; nothing accumulates there. |

Conclusion: **migration 013 is required.** The delta (§11): one retained
versioned scope-membership table (`ownership_scope_versions`, CORE), two
ephemeral work relations, a **composite FK added to the existing
`ownership_snapshots` table** enforcing snapshot→membership integrity,
**plus** the deployed `ownership_snapshots → ownership_scopes` FK changed
from CASCADE to `ON DELETE NO ACTION` (§5.9a), the
checkpoint/abandon/sweep primitives, and an amended
`dash_ownership_scopes`. Migration 012's file is never edited — 013 alters
the *deployed* `ownership_snapshots` by adding the membership FK and
changing the scope FK's delete action, and the base scope exclusion
columns become non-authoritative.

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
  `ownership_scope_versions` (§5.9), `ownership_contributors`,
  `ownership_snapshots` at `active_version`:
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

**Migration 013 therefore needs two EPHEMERAL work relations** plus the
retained `ownership_scope_versions` (§5.9). One table would be smaller
only by conflating two data classes with different sensitivity; the split
keeps the counter relation identity-free *by shape*.

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
from the build's `ownership_scope_versions` membership
(`order by depth, scope_path_hash` over V members) at any resume
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
                scope at fresh ACCUMULATE — restart cleanup below)
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

**Scope-restart staging cleanup (required — staging has no scope
provenance).** `ownership_contributor_build_work` is deliberately
build-level — `(repository_id, calculation_version, work_key)` — so
RESOLVE writes represented-key identity into it **before** the current
scope's COMMIT. If that scope then fails and restarts from a fresh
ACCUMULATE, staged rows written by the failed attempt can survive. This
matters: `author.user` linkage is allowed to drift between walks, so the
fresh accumulate can produce a *different* represented set — a stale
`work_key` from the failed attempt may no longer belong to any finalized
result. "Delete staged rows on scope restart" cannot be the rule, because
the build-grain relation cannot distinguish current-scope rows by scope.
The safe cleanup is defined by **committed-V provenance, not scope
provenance.** Before restarting the current scope at a fresh ACCUMULATE,
in ONE transaction under the repository ownership lock:

1. delete/reset `ownership_history_work` rows for the current scope;
2. inspect `ownership_contributor_build_work` for `building_version V`;
3. **preserve** staged keys whose `work_key` maps through
   `ownership_contributors.contributor_key` to a contributor row
   referenced by at least one **COMMITTED V snapshot** — i.e. keys
   already represented by an earlier finalized scope of this build;
4. **delete** staged keys with no committed-V-snapshot reference —
   including keys staged only by the uncommitted attempt for
   contributors new to the repository (no `ownership_contributors` row
   exists, hence no V snapshot) **and** existing active-N contributors
   staged only by the failed current scope (they likewise have no V
   snapshot for V — their retained rows stay; only the staging row is
   removed);
5. reset `current.pass`/`current.cursor` to a fresh ACCUMULATE.

The distinction is exact: a key represented by an earlier committed V
scope must survive (its staging is consumed by promotion); a key staged
only by the failed/uncommitted current scope must not (the fresh
accumulate may not represent it, and promotion must never apply stale
staging — §5.7's exact-set invariant is the second line of defense).

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
4. Delete `ownership_scope_versions` where `repository_id` and
   `calculation_version = V` — V's scope membership is version state of
   the abandoned build (§5.9).
5. Delete `ownership_history_work` and `ownership_contributor_build_work`
   for that repo/version.
6. Clear `building_version`, `history_cursor` build state, and
   `pending_scopes` for the build.
7. **Prune** `ownership_contributors` rows for the repository referenced
   by *zero* `ownership_snapshots` rows across *all* versions — the
   anti-join is what makes it safe: N-referenced contributors survive;
   V-only rows created solely to satisfy building-snapshot FKs are
   removed. Synthetic `unlinked`/`other` rows prune the same way — they
   are reconstructable.
8. **Prune** `ownership_scopes` base rows now referenced by NO
   `ownership_scope_versions` row AND NO `ownership_snapshots` row —
   V-only base identities are removed; N-referenced scopes always
   survive. Prospective 013 sets **both** retained child→base-scope FKs
   (`snapshots → scopes`, `scope_versions → scopes`) to `ON DELETE NO
   ACTION`, so a base scope referenced by any retained child
   **cannot be deleted at all** — the database rejects the delete
   (§5.9); this explicit unreferenced check is what makes the prune
   succeed rather than fail.
9. `active_version` is never touched; phase/error fall back to the state
   implied by whether an active version exists (closed taxonomy only).
   Existing contributor metadata and N scope membership need no
   restoration — they were never mutated.

The ordering is **required, not stylistic**: the prospective
`snapshots → scope_versions` FK is `ON DELETE NO ACTION` (§5.9), so any
cleanup that tried membership-first would *fail*, not cascade — and that
is the point: an incorrect cleanup must be incapable of destroying
active/retained data rather than merely unlikely to. No operation ever
deletes a membership row while snapshots still reference it.

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
initializes — necessary but not sufficient: the §5.6c retired-version
gate must also pass, so no overlapping building versions and no third
retained version, ever.

### 5.6b Required ephemeral-state validity

Whether a build is resumable is decided by internal consistency, not by
the mere presence/absence of counter rows:

| State-machine position | Required present | Allowed absent |
|---|---|---|
| ACCUMULATE mid-scope | `history_work` prefix rows may exist (or be empty pre-first-page); `contributor_build_work` for previously finalized scopes' represented keys | next pages |
| RESOLVE mid-scope | complete `history_work` counters for the scope; `contributor_build_work` for prior scopes | identity rows not yet observed in pass 2 |
| Between scopes | `contributor_build_work` for all represented keys of committed scopes; `pending_scopes` non-empty | `history_work` for the just-committed scope (consumed) |
| Ready to promote | `pending_scopes` empty; `contributor_build_work` exactly equal to the represented V key set (§5.7); zero `history_work` | — |

Zero `history_work` rows is **not** evidence of loss — it is the legal
state after each scope COMMIT and before promotion. Validation checks:
`building_version` non-null, phase/pass/current-scope consistent with
`history_cursor`, `pending_scopes` well-formed, **V's
`ownership_scope_versions` membership coherent** — every `pending_scopes`
entry and every V snapshot's `scope_id` has a V membership row
(`excluded=false` for pending entries); every represented key of every
already-committed scope having a `contributor_build_work` row; and no
orphaned V snapshots without their staging. Missing or corrupt V
membership is itself a fail-closed reason. If any check fails — never
reconstruct heuristically → `own_abandon_build`.

Role boundary: §5.6b validates *resumability* — cursor/pending/phase
coherence, ephemeral-state completeness, staging completeness. It is
**not** the integrity mechanism for snapshot↔membership: the
`snapshots → ownership_scope_versions` composite FK (§5.9) is primary and
makes a V snapshot without V membership impossible even if validation
has a bug. Application checks decide "can this build resume?"; the FK
decides "can this row exist?"

### 5.6c Retired-version lifecycle gate (CANONICAL)

The ≈≤1000 base-identity bound assumes only `active N + building N+1`
ever coexist — but post-promotion old-version GC currently runs in a
separate later transaction. Without a build-start gate, "promote N+1 →
old N awaits GC → start building N+2" leaves **N + N+1 + N+2** in
retained state and the bound is false. The lifecycle is therefore a
hard invariant, not housekeeping:

> **A repository may contain at most one `active_version` and,
> optionally, one `building_version`. No *retired* calculation version —
> a version whose snapshots/membership remain but which is neither
> `active_version` nor `building_version` — may exist when a NEW
> building version is initialized.**

After promotion, the old version may coexist transiently with the new
active version **only while the mandatory GC is pending**; while such
retired rows exist a new ownership build MUST NOT start. **No third
ownership version may coexist with a building version.**

**Fresh-build preflight** — every fresh build starts with, inside ONE
transaction under the repository ownership lock:

1. `SELECT FOR UPDATE` the `(user_id, repository_id)` sync-state row.
2. Verify `building_version` is null — a non-null value routes to
   §5.6b resume-or-abandon instead; fresh init never proceeds past it.
3. Identify **every** `calculation_version` present in
   `ownership_snapshots` or `ownership_scope_versions` that is not
   `active_version` — the retired set (normally the previous version
   awaiting post-promotion GC; empty in the common case).
4. Garbage-collect each retired version in the **legal order**:
   a. `ownership_snapshots` rows for the retired version;
   b. `ownership_scope_versions` membership rows for the retired version;
   c. `ownership_contributors` rows referenced by zero snapshots across
      all versions (anti-join);
   d. `ownership_scopes` base rows referenced by zero membership rows
      and zero snapshots (anti-join).
5. Verify **no retired-version rows remain** — re-check the retired set
   is empty inside the same transaction.
6. Only then pin the new revision and initialize `building_version`.

If preflight GC fails or cannot complete: **`active_version` keeps
serving normally and no new build starts.** The gate re-runs the same
GC on the next build-start attempt (and the scheduled sweep may run it
too); the GC is idempotent, so a partial earlier attempt is safe to
retry. This makes the §5.9 bound real rather than aspirational.

### 5.7 Promotion — atomic metadata application + version flip

When `pending_scopes` is empty, ONE transaction under the sync-row lock:

1. Verify: `building_version = V`; no `ownership_history_work` rows for V;
   snapshot cardinality within §11 bounds; and the **exact-set invariant**
   — the staged linked key set must *equal* the represented set, in both
   directions:
   - every `ownership_contributor_build_work` row for V maps (via
     `contributor_key = work_key`) to a contributor referenced by at
     least one building-V snapshot — **no extra staged keys** (a stale
     row from an abandoned scope attempt must have been removed by the
     §5.3 restart cleanup; a surviving one fails this check closed);
   - every linked contributor key represented in V snapshots has a
     staged build-work row — **no missing keys**.
   `set(staged work_key) == set(distinct contributor_key over V
   snapshots)` — synthetic `unlinked`/`other` buckets are excluded from
   both sides (they never enter contributor staging). Any asymmetry →
   promotion fails closed; nothing is applied.
2. Apply staged contributor metadata to retained rows —
   `UPDATE ownership_contributors ... FROM ownership_contributor_build_work`
   setting `github_node_id` (consistency-checked: same `work_key` must
   carry the same node id — mismatch fails closed), `display_login`,
   `is_bot` (the frozen pass-1 value), `first_seen_at`, `last_seen_at`.
   The update touches exactly the set validated in step 1 — stale
   staging rows can never write shared retained metadata. New
   contributors inserted at scope COMMITs already carry these values;
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
snapshots is a separate later transaction (spec §13), ordered to match
the `NO ACTION` child FKs: verify the collected version is not
`active_version` → delete old-version **snapshots** → delete old-version
`ownership_scope_versions` membership → prune contributors referenced by
no remaining snapshot → prune base scopes referenced by no membership
row and no snapshot. Membership is never deleted before its snapshots,
and no delete ever relies on cascading membership→snapshot. Until this
GC completes the retired version is still present, so the §5.6c gate
blocks any fresh build start — retired state is transient by
construction, never a third coexisting version.

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

### 5.9 Scope identity vs version membership — the same leak class

`ownership_scopes` is shared/unversioned exactly like
`ownership_contributors`, and the deployed `dash_ownership_scopes`
enumerates **base scope rows** filtered only by `active_version is not
null` — it does not require the scope to belong to the active version.
Three distinct leaks follow:

- **new-scope leak:** an N+1 scope row inserted during a build would
  appear in active-N `dash_ownership_scopes` output (with null N
  metrics);
- **metadata leak:** mutating `excluded`/`exclusion_reason`/
  `display_path`/`depth` on a shared scope alters active-N output;
- **deletion hazard:** under migration 012, `ownership_snapshots`
  FK-references scopes `ON DELETE CASCADE` — deleting a base scope
  during a build could cascade-destroy **active-N snapshots**. The new
  snapshot→membership FK protects membership integrity, but does not by
  itself close this path: an erroneous
  `DELETE FROM ownership_scopes WHERE id = <active scope>` could still
  remove active scope-version membership *and* active snapshots through
  cascades. Prospective 013 therefore changes the retained child→scope
  delete actions to `ON DELETE NO ACTION` (below), so the database
  itself rejects any base-scope delete while retained/versioned
  children reference it.

Resolution — split immutable identity from versioned membership:

**`ownership_scopes` stays the immutable repository/path identity
relation** (`id, user_id, repository_id, scope_path_hash, display_path,
scope_type, depth, created_at, updated_at`): never mutated merely because
another version is building; **undeletable while any snapshot or
membership row references it** — under prospective 013 both retained
child→base-scope FKs are `ON DELETE NO ACTION`, so "delete a referenced
scope" is rejected by the database, not merely forbidden by contract
(§5.9a). Vendor/generated/binary/submodule paths still never get a base
row; file scopes remain impossible.

**`ownership_scope_versions`** — RETAINED, CORE-classified, grain
`(scope_id, calculation_version)` plus `user_id`/`repository_id` for
DB-enforced tenant scoping:

| Field | Semantics |
|---|---|
| `scope_id`, `calculation_version` | the scope belongs to that version |
| `excluded`, `exclusion_reason` | **version-sensitive** cardinality state — a dir can be inside the ≤500 set in N and outside in N+1 as the tree changes; `excluded=true` permitted only with `'cardinality_cap'` (existing contract preserved); lives here, not on the shared base row |
| `created_at`, `updated_at` | housekeeping |

Rules: one membership row ⇒ the scope belongs to that version;
`excluded=false` ⇒ analyzed/included; `excluded=true` ⇒ cardinality-cap
marker for that version only. The base row's `excluded`/
`exclusion_reason` columns become **non-authoritative legacy** after 013
(new base rows always `excluded=false`; the columns may be dropped only
if a later migration explicitly justifies it — 012 is never edited
retroactively).

**Exact membership semantics:**

- **NO membership row for `(scope, V)`** — "this scope does not belong to
  calculation version V." Not persisted, not served, not analyzable for V.
- **`excluded=false`** — "this scope belongs to V and is analyzed."
- **`excluded=true, exclusion_reason='cardinality_cap'`** — "this scope
  belongs to the *bounded persisted set* for V, but analysis was omitted
  because the approved repository snapshot/storage cardinality budget
  would be exceeded." This is the **only** permitted exclusion reason.
- `excluded=true` is **never** a generic "the repository contained this
  path" inventory marker.

**The two caps are distinct — do not conflate them:**

- **Hard directory-enumeration cap (500/version):**
  `deriveScopeCandidates().scopes` yields the bounded selected directory
  set (repo scope is separate). `deriveScopeCandidates().overflow` —
  eligible directories beyond the hard cap — is **never persisted
  individually**: no `ownership_scopes` base row, no
  `ownership_scope_versions` row, no `display_path` in durable storage,
  logs, or telemetry. Persisting overflow as `excluded=true` rows would
  make the private-path inventory unbounded and defeat the cap's purpose.
- **Analysis cardinality cap (the legitimate `cardinality_cap` use):** an
  *already-selected, inside-the-500* scope whose projected snapshot volume
  would breach the repo snapshot budget may be marked
  `excluded='cardinality_cap'` — membership stays; analysis is skipped.

**Bounds, stated honestly — defined per lifecycle phase** (the phases are
the only states in which base identities exist; the retired-version GC
gate in §5.6c is what makes them exhaustive):

- **NORMAL IDLE** — only `active_version` membership is retained: ≤500
  directory memberships; `ownership_scopes` holds ≤500 base directory
  identities plus the repo scope.
- **DURING BUILD** — active N (≤500) + building N+1 (≤500) coexist;
  `ownership_scopes` holds the *union* of two bounded sets — worst case
  ≈≤1000 base directory identities with zero overlap; normal overlap is
  far lower.
- **IMMEDIATELY AFTER PROMOTION** — the previous (retired) version's
  membership/snapshots may coexist transiently with the new active
  version **only while the mandatory old-version GC is pending** — and
  **no new build may start in this state** (§5.6c). This is a
  GC-pending state, not a third lifecycle phase for serving.
- **AFTER GC** — identities referenced by neither retained membership
  nor snapshots are pruned; `ownership_scopes` returns to the
  active-only bound.

≤500 **directory memberships per calculation version** (repo scope
separate); ≈≤1000 base identities is the durable worst case during a
rebuild — never exceeded, because **no third ownership version may
coexist with a building version** (§5.6c) and a retired version may
exist only in the GC-pending window after promotion. **No unbounded
accumulation of historical directory identities** — abort and GC prune
identities referenced by nothing retained.

**DB-enforced snapshot→membership integrity (hard invariant):**
application validation alone must not be the only thing preventing a
`scope_id/calculation_version` snapshot with no matching membership.
Prospective 013 provides a supporting unique key on
`ownership_scope_versions` over the full tenant boundary —
`(scope_id, repository_id, user_id, calculation_version)` — and `ALTER
ownership_snapshots` adds a composite FK on the same four columns
referencing it, with **`ON DELETE NO ACTION`** (not CASCADE, not left
unspecified between NO ACTION and RESTRICT — see §5.9a for why the exact
action is named): deleting a membership row must never be a path that
destroys snapshots — cleanup order is always snapshots first, membership
second (§5.6, §5.7). The composite columns make the DB itself prove
same-scope + same-repo + same-tenant + same-version; a V snapshot
without V membership is **impossible**. Repository/account deletion
still cascades completely — the cascade arrives via the other FKs
(`snapshots→repositories`, `membership→repositories`), so the
`NO ACTION` membership FK adds no teardown hazard; this is verified
against real Postgres during implementation (§5.9a proof plan).

### 5.9a Base-scope delete enforcement — `NO ACTION` on both retained child FKs

The membership FK above protects snapshots from *membership* deletion,
but a second, older destructive path remains: `DELETE FROM
ownership_scopes` directly. Under 012, `ownership_snapshots →
ownership_scopes` is `ON DELETE CASCADE`, and a cascading
`ownership_scope_versions → ownership_scopes` FK would give an erroneous
direct scope delete the power to remove **active membership and active
snapshots in one statement** — contradicting the invariant that deleting
a referenced base scope is forbidden. Prospective 013 therefore sets:

| Child → `ownership_scopes` FK | Action |
|---|---|
| `ownership_snapshots(scope_id, repository_id) → ownership_scopes(id, repository_id)` — **existing 012 constraint, altered by 013** | `ON DELETE NO ACTION` |
| `ownership_scope_versions(scope_id, repository_id) → ownership_scopes(id, repository_id)` — new in 013 | `ON DELETE NO ACTION` |

**No retained child→base-scope relation uses CASCADE.** A base-scope
prune (§5.6 step 8, §5.7 GC, §5.6c preflight GC) succeeds **only after**
snapshots *and* scope-version memberships no longer reference it —
the legal order is snapshots → membership → then the base row, enforced
by the database rather than by convention. The ephemeral
`ownership_history_work → ownership_scopes` FK stays `CASCADE` (it is
not retained child state and plays no part in the protected graph); the
direct `(repository_id, user_id)` and `user_id` FKs on every ownership
table stay `CASCADE`, so repository/account teardown still removes the
entire graph in one statement.

**Why `NO ACTION`, exactly — not "NO ACTION/RESTRICT":** repository or
account deletion is *one* statement whose referential actions remove
snapshots, memberships, and scopes through their direct
repository/user cascade FKs. `NO ACTION` checks referential validity
**after** the statement's referential actions have occurred — a parent
scope deleted in the same statement as its (already cascade-removed)
children passes. `RESTRICT` checks eagerly and can reject that same
teardown depending on the order the engine walks the constraint graph.
The architecture names **`ON DELETE NO ACTION`** as the exact intended
action for every retained ownership child FK; implementation changes it
only if the real-Postgres migration test proves otherwise.

**Required real-Postgres proof plan (migration/drill tests, not
mocks):**

- direct `DELETE FROM ownership_scopes` on a base scope referenced by
  **active membership** → rejected;
- direct delete on a base scope referenced by **active snapshots** →
  rejected;
- delete the version's snapshots, then its membership, then the base
  scope → **succeeds** (the legal prune order);
- `DELETE FROM repositories` → the complete ownership graph (scopes,
  scope versions, contributors, snapshots, sync state, both work
  relations) cascades away in one statement;
- `DELETE FROM users` → same.

The last two are the teardown contract §14 requires — they exist to
prove the `NO ACTION` choice does not degrade repository/account
deletion under the real engine, not as theory.

**Build flow:** at N+1 init — **fresh-build preflight (§5.6c):** lock
the sync-state row → verify `building_version` is null → garbage-collect
every calculation version other than `active_version` in legal order →
verify no retired-version rows remain — **then** pin revision →
enumerate eligible scopes → insert missing base identity rows → insert
N+1 membership rows → derive `pending_scopes` from N+1 membership where
`excluded=false` → walk. New base rows may exist pre-promotion **only
because dashboard reads will join membership** — without membership for
`active_version` they are invisible. Existing N membership is never
touched.

**RPC:** `dash_ownership_scopes` must be amended to join
`ownership_scope_versions` on `calculation_version = st.active_version`
and take `excluded`/`exclusion_reason` from membership — N+1-only scopes
cannot appear, and N exclusion state cannot move. `dash_ownership_head`/
`dash_ownership_timeline` reach scopes only through version-filtered
snapshot rows, so they are already correct — but all three RPCs get an
explicit version-consistency audit at implementation.

**Promotion:** membership needs no rewrite — the flip swaps which
version's membership the RPC joins, atomically with the contributor
metadata application (§5.7). **GC:** when old version N is collected,
the order is fixed — delete N's **snapshots** → delete N's
**membership rows** → prune contributors referenced by no remaining
snapshot → prune base scopes referenced by no membership row *and* no
snapshot. `NO ACTION` on both retained child→base-scope FKs (§5.9a)
makes any other order *fail* rather than cascade away referenced/active
data. The GC may run after promotion, but a **fresh build may not start
until it completes** (§5.6c). **Abandon** (§5.6) additionally deletes
V's membership rows and prunes V-only base scopes that are then
referenced by nothing.

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
| Directory memberships per version | 500 | hard enumeration cap from `deriveScopeCandidates`; overflow paths get no base row, no membership row, no persisted `display_path` (§5.9) |
| Base scope identities per repo | ≤500 idle; ≈≤1000 during build; transient while retired-version GC is pending | union of active N + building N+1 bounded sets; a third version can never coexist — the §5.6c gate blocks new builds until retired GC completes; pruned on abort/GC — never unbounded accumulation |
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
  check §5.6b → resume or `own_abandon_build`, plus the §5.6c
  retired-version GC gate before any fresh init; (b) a periodic sweep
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
2. **§6.4's substantive guarantee preserved** — the live §6.4 text stays
   unchanged until this amendment is adopted (it is not claimed verbatim —
   the amendment deliberately persists the pseudonymous `work_key` in
   EPHEMERAL build state). What is guaranteed exactly as before: overflow
   contributors receive **no retained `ownership_contributors` row** and
   their `github_node_id`/`display_login` never reach *any* persisted
   state — only the pseudonymous `work_key` may exist, and only in the
   short-lived EPHEMERAL relations under the §3 conditions. Staged
   build-work rows exist only for contributor keys pass 1 already proved
   individually represented.
   **Scope version isolation (§5.9):** `ownership_scopes` base rows are
   immutable identity only; per-version `excluded`/`exclusion_reason`
   state moves to retained `ownership_scope_versions` (CORE, grain
   `scope_id × calculation_version`). Building versions may add base
   scope identities and N+1 membership, but dashboard reads enumerate
   only `active_version` membership — a new N+1 scope is invisible and N
   exclusion state cannot move. The base row's exclusion columns become
   non-authoritative after 013; base scopes referenced by any snapshot or
   membership row are **undeletable** — both retained child→scope FKs
   become `ON DELETE NO ACTION` (§5.9a), and a no-longer-referenced base
   scope is removed only by the explicit prune.
   **Lifecycle bound (§5.6c):** at most one `active_version` plus one
   `building_version` may exist; a retired version's rows may remain only
   while post-promotion GC is pending, and no fresh build may initialize
   until retired-version GC completes — a third coexisting version is
   impossible, which is what makes the ≈≤1000 base-identity bound a real
   bound.
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
   **Abort cleanup:** abandoned builds delete their versioned snapshots,
   their `ownership_scope_versions` membership, and ephemeral state, then
   prune `ownership_contributors` rows unreferenced by any snapshot in
   any version and base scopes referenced by no membership row and no
   snapshot — retained-version contributors and scopes always survive
   (§5.6); contributor metadata was never mutated, so nothing needs
   restoration.
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
  `ownership_scope_versions` → **CORE** — it is required to interpret
  active ownership state (it carries which scopes belong to
  `active_version` and their authoritative exclusion state), so it must
  be dumped and restored exactly like `ownership_snapshots`. Verified
  against the revision-5 state model: losing the EPHEMERAL relations
  never loses active user data — the recovery cost is **"discard the
  incomplete building version and rebuild it,"** not "resume the current
  scope." Dumping them would persist pseudonymous state for zero benefit;
  the EPHEMERAL classification stands.
- **Restore semantics — abandon, never piecemeal-resume:** restore
  returns `ownership_sync_state` (OPERATIONAL) plus all CORE ownership
  rows — including V's `ownership_scope_versions` membership and V's
  snapshots — but no work rows. If the
  restored row has `building_version = V`, the required build state for V
  is by definition absent/incomplete → V is unrecoverable → run
  `own_abandon_build`: delete V snapshots **and V scope membership**,
  delete any surviving V work rows, prune unreferenced V-only
  contributors and V-only base scopes, clear V build state. Then
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

**RETAINED (CORE):**

- `create table public.ownership_scope_versions` — §5.9: composite
  tenant FK `(repository_id, user_id) → repositories` `on delete
  cascade` (repository/account teardown unchanged) **plus** scope FK
  `(scope_id, repository_id) → ownership_scopes(id, repository_id)` `on
  delete no action` (§5.9a — a base scope referenced by membership
  cannot be deleted); unique
  `(scope_id, calculation_version)` for membership uniqueness **plus** the
  supporting unique `(scope_id, repository_id, user_id,
  calculation_version)` that the snapshot FK targets — the four-column
  key is what lets the FK *prove* same-tenant/same-repo/same-version, not
  merely same-scope; `excluded boolean not null default false`; CHECK
  `excluded → exclusion_reason = 'cardinality_cap'` and
  `not excluded → exclusion_reason is null` (the spec's
  `ownership_scopes_exclusion` contract, versioned); CHECK
  `calculation_version > 0`. RLS enabled, zero
  policies, `service_role` DML only — the retained-table security model,
  **not** the ephemeral one: it is CORE backup state.
- `ownership_scopes.excluded`/`exclusion_reason` become
  **non-authoritative legacy**: new base rows always write
  `excluded=false, exclusion_reason=null`; authoritative per-version
  state lives in `ownership_scope_versions`. The columns may be dropped
  only by a later explicitly justified migration — 012 is never edited
  retroactively.

**EXISTING TABLE CHANGES (both on 012-deployed `ownership_snapshots`;
migration 012's file itself is never touched — 013 alters the deployed
constraints):**

- `alter table public.ownership_snapshots add foreign key
  (scope_id, repository_id, user_id, calculation_version) references
  ownership_scope_versions (scope_id, repository_id, user_id,
  calculation_version) on delete no action` — the DB-enforced
  membership invariant (§5.9): a snapshot can exist only for a scope
  that belongs to the snapshot's own calculation version, repository,
  and tenant. `ON DELETE NO ACTION` — **not** CASCADE — so deleting a
  membership row can never destroy snapshots; abort/GC ordering is
  snapshots first, membership second (§5.6, §5.7).
- `alter table public.ownership_snapshots drop constraint
  ownership_snapshots_scope_repo, add foreign key
  (scope_id, repository_id) references ownership_scopes
  (id, repository_id) on delete no action` — the §5.9a base-scope
  invariant: the existing `ON DELETE CASCADE` lets an erroneous direct
  scope delete destroy active snapshots and membership; `NO ACTION`
  makes the delete fail while any snapshot references the scope. The
  constraint is re-created under the same name/keys; only the delete
  action changes.

The exact action is **`ON DELETE NO ACTION`** for all three retained
child→scope/membership relations (§5.9a explains why NO ACTION rather
than RESTRICT or CASCADE); the real-Postgres migration test in §5.9a is
the required proof that the choice is correct, including that single-
statement repository/account teardown still cascades the complete
ownership graph.

**EPHEMERAL:**

- `create table public.ownership_history_work` — §4.4 columns; composite
  FKs `(repository_id, user_id) → repositories` and
  `(scope_id, repository_id) → ownership_scopes(id, repository_id)`, all
  `on delete cascade` (EPHEMERAL rows are not retained children — the
  §5.9a NO ACTION rule applies to the two retained child→scope
  relations only); unique `(scope_id, calculation_version,
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
  covers scope-COMMIT (§5.3), the §5.3 scope-restart staging cleanup
  (committed-V-provenance-preserving deletion before fresh ACCUMULATE),
  promotion (§5.7), and the §5.6c fresh-build preflight GC gate —
  whether as additional functions or a client-managed multi-statement tx
  is an implementation detail of 1C-B.
- `own_abandon_build(p_user, p_repository, p_version)` — **the canonical
  build-abandonment primitive** (§5.6): locks the sync-state row,
  validates the expected `building_version`, deletes the version's
  snapshots **and `ownership_scope_versions` membership**, deletes both
  ephemeral relations, anti-join prunes unreferenced contributors **and
  unreferenced base scopes** (no membership row AND no snapshot), clears
  build state, preserves `active_version`. There is ONE semantic abandon
  operation — the stale sweep, restore reconciliation, operator abort,
  and invalid-state recovery all call it.
- `own_sweep_stale_work(...)` — repository-build-aware: bare-deletes
  orphan work rows only when `building_version` is null; for a genuinely
  stale live build (no lease, no activity in 14 days) it calls
  `own_abandon_build` — same security shape.
- `create or replace function dash_ownership_scopes(uuid, uuid)` —
  **amended for version isolation**: joins `ownership_scope_versions`
  where `calculation_version = st.active_version` and takes
  `excluded`/`exclusion_reason` from membership; returns only
  active-version scopes. `dash_ownership_head`/`dash_ownership_timeline`
  reach scopes only through version-filtered snapshot rows — audit all
  three at implementation; signature stays `security invoker` with the
  same tenant checks.
- `backup-scope.mjs`: append `ownership_history_work` and
  `ownership_contributor_build_work` to `EPHEMERAL_TABLES`;
  `ownership_scope_versions` goes to the CORE ownership set (same PR —
  CI requires classification).
- Recovery-drill addition: assert all three new tables exist
  post-migration; the two work relations are absent from dumps;
  `ownership_scope_versions` **is present** in dumps and restores; the
  snapshot→membership FK is enforced (a snapshot without membership is
  rejected); the legal abort/GC delete ordering works (snapshots, then
  membership); **the §5.9a base-scope enforcement is proven** — direct
  delete of a scope referenced by active membership or snapshots is
  rejected, while the legal snapshots→membership→scope order succeeds;
  repository and account deletion still cascade the complete ownership
  graph **in a single statement** after the FK action changes.
- **Two existing-table changes**: the `ownership_snapshots` composite
  membership FK above, and the `ownership_snapshots_scope_repo` FK
  action change CASCADE → NO ACTION. Otherwise `phase` enum already
  contains `history`; resolve is cursor-jsonb state, not a new phase;
  the error taxonomy already covers every failure mode in §13; and the
  only existing-object change is `create or replace` on
  `dash_ownership_scopes` — same signature, same grants, version-correct
  semantics.

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
- **Scope version isolation (§5.9):**
  - N active, N+1 enumerates a brand-new directory scope: base scope row
    and N+1 membership may exist, but active-N `dash_ownership_scopes`
    output is byte-identical — the new scope is invisible until
    promotion;
  - N+1 changes the cardinality-cap selection (a dir excluded in N is
    included in N+1 or vice versa): active-N `excluded`/
    `exclusion_reason` values unchanged, N+1 state isolated in its own
    membership rows;
  - N+1 abort: N membership and output byte-identical, N+1 membership
    deleted, N+1-only unreferenced base scope identities pruned,
    N-referenced scopes preserved;
  - N+1 promotion: the active scope set switches atomically with the
    `active_version` flip — no observable mixed N/N+1 scope set;
  - post-promotion old-version GC: N membership deleted at the retention
    point, then base scopes referenced by nothing pruned — active
    scopes/snapshots never cascade away;
  - a delete attempt on a base scope still referenced by active-version
    membership or snapshots is **rejected by the database** — both
    retained child→scope FKs are `NO ACTION` (§5.9a); never a cleanup
    path.
- **DB-integrity tests — real Postgres (drill/migration tests, not
  mocks):**
  - membership S/V exists → snapshot S/V succeeds;
  - snapshot S/V with no membership S/V → **rejected**;
  - membership S/V1 only → snapshot S/V2 **rejected** (wrong version);
  - membership from repo A → snapshot claiming repo B **rejected**;
  - membership under user A → snapshot under user B **rejected**
    (cross-tenant);
  - delete membership while a snapshot references it → **rejected** by
    the `NO ACTION` FK;
  - delete V snapshots first, then V membership → succeeds;
  - **direct `DELETE FROM ownership_scopes` on a base scope referenced
    by active membership → rejected** (`scope_versions → scopes` is
    `NO ACTION`);
  - **direct delete on a base scope referenced by active snapshots →
    rejected** (`snapshots → scopes` is `NO ACTION` after the 013
    constraint change — an erroneous direct scope delete cannot
    cascade-destroy active data);
  - delete the version's snapshots → its membership → then the base
    scope → **succeeds** (the only legal base-scope prune order);
  - repository delete → full ownership graph cascades **in one
    statement** (proves `NO ACTION` child FKs do not degrade teardown);
    account delete → same.
- **Cardinality tests:**
  - ≤500 selected directory candidates → ≤500 V membership rows (repo
    scope separate);
  - 501+ eligible dirs → derivation overflow non-empty; overflow paths
    get NO base row, NO membership row, and their `display_path` never
    reaches DB/logs/telemetry;
  - a selected in-cap scope dropped on projected snapshot-volume →
    membership `excluded=true, 'cardinality_cap'` — and still counts
    inside the ≤500 membership set;
  - active N (≤500) + building N+1 (≤500) → base-scope table bounded by
    the union, no unbounded accumulation;
  - abort N+1 → N+1-only base identities pruned; promote N+1 + GC N →
    N-only base identities pruned.
- **Scope-restart staging tests (§5.3):**
  - *current scope RESOLVE partially stages then fails:* prior committed
    V scopes exist; current scope stages new key X; a later represented
    key fails resolution → scope restarts → X's staged row is removed
    (no committed V snapshot references it); prior committed staging is
    preserved;
  - *existing active-N contributor staged only by the failed V scope:*
    contributor row already exists from active N; failed N+1 scope
    stages its key; no committed N+1 snapshot references it → restart
    removes its build-work row; the retained row itself is untouched and
    promotion cannot update it accidentally;
  - *key shared with an earlier committed V scope:* the failed current
    scope stages a key an earlier V scope already finalized → the
    earlier V snapshot references the contributor → restart preserves
    the build-work row;
  - *represented set changes after fresh ACCUMULATE:* linkage drift
    produces a different represented set on restart → stale keys from
    the previous attempt survive only if referenced by committed V
    snapshots; all others are gone before the new accumulate begins;
  - *ready-to-promote with an extra build-work key:* a staged key with
    no represented V snapshot → promotion validation rejects/fails
    closed (exact-set invariant);
  - *ready-to-promote with a missing build-work key:* a represented V
    key with no staged row → promotion rejects/fails closed;
  - *exact set:* staged linked keys exactly equal the union of
    represented linked keys in V snapshots → promotion succeeds and
    applies metadata to exactly that set.
- **Lifecycle / GC-gate tests (§5.6c):**
  - *no third version:* N promoted over by N+1, retired N rows still
    present (GC pending) → a request to initialize N+2 **does not start
    a build** — `building_version` stays null;
  - *gate completes then builds:* same state → preflight GC removes
    retired N rows in legal order (snapshots → membership → unreferenced
    contributors → unreferenced base scopes) → only then does the fresh
    build initialize `building_version`;
  - *retired-version GC failure:* forced GC error mid-preflight →
    `active_version` N+1 keeps serving, no `building_version` is set,
    next attempt retries the same GC (idempotent partial GC safe);
  - *no retired state:* `active_version` only, `building_version` null,
    zero retired rows → preflight is a no-op and the build initializes
    immediately.

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
| Represented key unresolvable in pass 2 | staging incomplete | bounded retry → restart scope at fresh ACCUMULATE → `OWNERSHIP_HISTORY_FAILED` | — | — | scope restarts; §5.3 cleanup preserves staging referenced by committed V snapshots, deletes the rest |
| Pass-2 bot-classification drift | staging not written for that key | same fail-closed restart at fresh ACCUMULATE | frozen pass-1 `is_bot` is the only authority | — | scope restarts; §5.3 cleanup deletes uncommitted staging |
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
| N+1 inserts new base scope + membership | N+1-only membership + base identity | n/a | dashboard joins only active-version membership — new scope invisible in N output | — | abort/GC prunes unreferenced base scope (§5.9) |
| N+1 changes cardinality-cap selection | per-version exclusion state on N+1 membership | n/a | N's `excluded`/`exclusion_reason` on its membership rows unchanged | — | shared base row never mutated; abort removes N+1 membership |
| Direct delete of base scope referenced by active data | **rejected by the database** — `snapshots→scopes` and `scope_versions→scopes` are `NO ACTION` (§5.9a) | n/a | active membership/snapshots cannot be cascade-destroyed | — | prune only deletes scopes referenced by NO membership AND NO snapshot (§5.6) |
| Restore: V membership + V snapshots restored, work absent | sync claims building V; CORE rows present, EPHEMERAL absent | never piecemeal-resume | — | — | `own_abandon_build` deletes restored V membership + snapshots too |
| Snapshot insert without V membership | impossible — composite FK `(scope, repo, user, version)` → `ownership_scope_versions` rejects it | n/a | DB-enforced, not app-only | — | row cannot exist |
| Delete membership while snapshot references it | rejected — FK is `ON DELETE NO ACTION` | n/a | incorrect cleanup cannot destroy snapshots | — | ordering enforced by the constraint |
| Hard-cap overflow directory path | no base row, no membership row | n/a | `display_path` never persisted | — | nothing to clean — never written |
| Fresh build requested while retired version rows remain | previous version awaiting post-promotion GC | preflight GC runs first — build does not initialize while retired rows exist | no third version can coexist (§5.6c) | — | GC in legal order: snapshots → membership → unreferenced contributors → unreferenced base scopes |
| Retired-version GC fails mid-preflight | partial GC progress (idempotent) | retry on next build-start/sweep — never a build start | `active_version` keeps serving normally | — | `building_version` stays null; GC re-runs until retired set is empty |
| Resolve fails after partial build staging | `contributor_build_work` may hold keys staged only by the uncommitted scope | scope restart at fresh ACCUMULATE | restart cleanup preserves only keys referenced by committed V snapshots | — | uncommitted-only staging deleted in the restart transaction (§5.3) |
| Promotion validation finds an extra staged key | staging set ⊋ represented V key set | promotion rejected — fails closed | no shared contributor metadata written | — | exact-set invariant (§5.7): stale staging can never apply |
| Promotion validation finds a missing staged key | staging set ⊊ represented V key set | promotion rejected — fails closed | no shared contributor metadata written | — | same exact-set invariant |

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
| K. Scope membership versioned + DB-enforced? | **YES** | §5.9 — retained `ownership_scope_versions` (CORE) + composite snapshot→membership FK (NO ACTION); `dash_ownership_scopes` joins membership at `active_version` |
| L. Referenced base scope undeletable? | **YES** | §5.9a — both retained child→scope FKs `ON DELETE NO ACTION`; repo/account teardown still cascades via the direct repository/user FKs |
| M. Third version coexistence impossible? | **YES** | §5.6c — fresh-build preflight GCs every retired version before `building_version` initializes; GC failure = no new build |
| N. Stale staging cannot reach promotion? | **YES** | §5.3 — restart cleanup keeps only committed-V-referenced keys; §5.7 — promotion requires the staged set to *equal* the represented set |

## 17. Readiness verdict

**Ready to IMPLEMENT Phase 1C-B: NO.** Three prerequisites, in order:

1. Approval of the §8 contract amendment (ephemeral pseudonymous counters
   + represented-key identity staging + pinned build SHA).
2. Phase 1C-B0.5 non-persisting spike measuring pinned-revision history
   walks, pinned tree enumeration, and unreachable-oid behavior (§10).
3. Then: migration 013 + the engine implementation behind the existing
   hard-off gate.
