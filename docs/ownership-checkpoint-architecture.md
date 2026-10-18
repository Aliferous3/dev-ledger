# Ownership Checkpoint Architecture — Phase 1C-B0 Design

> **Status: design only. Nothing in this document is implemented or live.**
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
amendment is one ephemeral, backup-excluded work table holding
*pseudonymous counters only* — no GitHub identity fields — plus one atomic
checkpoint primitive. This is §5 below; the required contract amendment is
recorded in §8 and in the spec's new proposed-amendment appendix.

---

## 1. Fundamental verdict: four tables are NOT sufficient

Checked against `012_ownership.sql` as deployed:

| Candidate storage | Why it cannot carry work state |
|---|---|
| `ownership_snapshots` | Contributor rows require `contributor_id` → a durable `ownership_contributors` row → requires `github_node_id`/`display_login` non-null (`ownership_contributors_linked` CHECK). Overflow identities would be written. Also no month-keyed accumulation shape without polluting immutable period facts. |
| `ownership_contributors` | The linked CHECK **forces** `github_node_id` + `display_login` — pseudonym-only provisional rows are impossible by construction, and persisting identities is exactly what §9.1 forbids. |
| `ownership_sync_state` (`history_cursor`/other jsonb) | Technically possible, rejected in §3.2: it is OPERATIONAL (dumped into backups — provisional pseudonyms would leak into every dump), a single JSONB row is a read-modify-write hotspot with unbounded growth, and it cannot be CHECK-constrained per element. |
| `ownership_scopes` | Scope definition only; nothing accumulates there. |

Conclusion: **migration 013 is required.** The delta is minimal (§11): one
work table + one checkpoint function. No existing column or constraint
changes.

---

## 2. The central privacy question — what may persist provisionally

Three distinct things must not be conflated:

| Level | Content | Status |
|---|---|---|
| A. GitHub identity | `author.user.id` (node id), `login`, name, email | Durable only for *represented* contributors (§6.4); prohibited for overflow; emails/names prohibited always |
| B. Final `contributor_key` | `sha256(domain ∥ repo_uuid ∥ node_id)` | **Already durable** for represented contributors; opaque; carries no displayable identity |
| C. Build-scoped work key | any pseudonym valid during a build | Proposed for provisional counters |

Key observation: **`contributor_key` itself is not an identity field.** It
is a repo-scoped SHA-256 over the internal repository uuid and the node id.
It cannot be rendered as a name, cannot be looked up on GitHub (GraphQL
node ids are opaque, non-enumerable strings — preimage search requires
guessing them), and the contract already persists it durably for every
represented contributor.

Proposed rule (§8 amendment): **provisional work state may persist the same
`contributor_key` that would be durable if the contributor ends up
represented — and nothing else about identity.** Overflow contributors
therefore leave behind only an opaque 64-hex string that is deleted at scope
finalization, excluded from backups, cascades on repo deletion, and is swept
by TTL on abandoned builds. This is a *narrow* amendment: the §6.4 guarantee
"overflow-only contributors get no durable identity row" is preserved
verbatim — the work row is not an identity row and is never durable.

Why not a build-nonce key (`hash(domain ∥ nonce ∥ repo ∥ node_id)`)? It adds
nothing the deterministic key doesn't already provide (both are opaque
pseudonyms under the same threat model — an actor who can preimage-attack
sha256 breaks either), and it **breaks Top-25 tie determinism** (§7): the
reducer ranks by `touch_commits desc, contributor_key asc`. With nonce keys
the ranking would need a key-mapping pass and two builds could diverge at
rank-25 ties. Deterministic keys make work-row ordering literally equal to
final ordering — proof by construction, not by argument.

**Rejected alternative:** persisting `github_node_id`/`display_login` in a
provisional identity map (even ephemeral). That stores real identity for
overflow contributors — a *qualitative* expansion of stored PII, not a
quantitative one. It is the cheap engineering answer and the wrong privacy
answer. The two-pass design (§4) makes it unnecessary.

---

## 3. Options evaluated

### 3.1 Option A — no provisional persistence (restart-in-invocation)

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
- There is **no hard bound** on "a month/scope fits one invocation" — failure
  is permanent, not slow.

**Rejected — no completion guarantee.**

### 3.2 Option B — JSONB accumulator inside `ownership_sync_state`

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

### 3.3 Option C — provisional rows in existing ownership tables

- `ownership_contributors_linked` CHECK *requires* `github_node_id` +
  `display_login` for linked rows — the schema itself forbids pseudonym-only
  provisional contributors. Weakening the CHECK to admit provisional rows
  weakens the durable contract to accommodate the mechanism: backwards.
- Writing overflow identities "temporarily" is still writing them — §9.1
  names this explicitly.
- `ownership_snapshots` monthly rows are immutable period facts; using them
  as accumulators forces dummy `contributor_id` values → same identity
  problem.
- `active_version` gating does prevent *serving* partials, but the problem
  here is *storing* identity, not *serving* it.

**Rejected on both privacy and schema-fit grounds.**

### 3.4 Option D — dedicated ephemeral work table (RECOMMENDED)

One table, `ownership_history_work`, existing only for the duration of a
build. Scope-at-a-time processing bounds it to one scope's state.

Minimal necessary shape (final column list is 013's; the contract is):

| Column | Why it is necessary |
|---|---|
| `user_id`, `repository_id` | tenant composite FK → cascade deletes on repo/user removal |
| `scope_id` | composite FK `(scope_id, repository_id) → ownership_scopes` — ties work to one scope; file paths never appear |
| `calculation_version` | isolates build N+1 work from served N; enables failed-build GC by version |
| `period_start` | month key — the aggregation grain |
| `work_key` | `contributor_key` — or the literal `'unlinked'` for the single unresolved bucket; CHECK `work_key='unlinked' or work_key ~ '^[0-9a-f]{64}$'` prevents squatting and makes the two classes structurally disjoint |
| `is_bot` | boolean only — required because `human_contributor_count` needs the bot bit for **every** linked contributor including overflow-only ones, whose login is never persisted |
| `touch_commits` | the accumulated count — the point of the table |
| `first_seen_at`, `last_seen_at` | min/max `committedDate` within the month — preserves exact durable-candidate timestamps (see §5.3) |

**Never stored here:** `github_node_id`, `login`, email, name, path, raw
node, SHA (the pin lives in `history_cursor`, §10), page payloads.

It solves exact Top-25 (all contributions for the scope are present at
finalize), exact human count (distinct `work_key` where `not is_bot`),
crash recovery (page deltas + cursor are one transaction, §5.1), privacy
(no identity fields), bounded storage (§6), deletion (FK cascades + scope
delete + TTL sweep), and it is cleanly backup-excludable (§9).

---

## 4. Recommended architecture

**Option D + scope-sequential processing + per-scope two-pass identity
resolution + atomic page checkpoints + pinned-revision walks.**

### 4.1 Build state machine

`ownership_sync_state` (unchanged columns; `history_cursor` jsonb carries
all checkpoint detail):

```
pending → history → done | error        (phase enum — unchanged)
```

`history_cursor` jsonb during `history`:

```jsonc
{
  "pinned_oid": "<40-hex>",                       // build boundary, §10
  "scope_order": ["<scope uuid>", ...],           // deterministic
  "current": {
    "scope_id": "<uuid>",
    "pass": "accumulate" | "resolve",
    "cursor": "<graphql endCursor>" | null
  },
  "lease": { "owner": "<worker uuid>", "expires": "<ts>" }   // §14
}
```

`pending_scopes` jsonb: remaining scope ids (existing column, existing
purpose). `blame_cursor` untouched — HEAD blame is a later tranche.

Per-scope lifecycle (scopes processed in `scope_order`; repo scope first —
its resolve pass captures the bulk of identities once):

```
ACCUMULATE   walk history(pinned_oid, path=scope) page by page;
             each page → own_checkpoint_page CAS tx (§5.1)
             until hasNextPage=false
RESOLVE      re-walk the same scope's pinned history (pass 2);
             per page, inside the SAME CAS mechanism:
             recompute work_key for each node; for keys ∈ represented set
             (recomputed deterministically from work rows each invocation),
             upsert the durable ownership_contributors row
             {contributor_key, github_node_id, display_login, is_bot};
             skip pass entirely if every represented key already has a row
COMMIT       single tx: load work rows → run the reducer algorithm →
             upsert contributor first/last_seen_at → insert snapshot
             contributor rows + scope-total rows (building_version) →
             delete this scope's work rows → advance pending_scopes /
             clear current cursor
```

When `pending_scopes` empties: promotion tx — validate zero remaining work
rows for `building_version`, expected snapshot cardinality within §11
bounds, then `active_version = building_version; building_version = null;
phase = 'done'` in one update. Old-version GC is a separate, later
transaction (active version is already flipped — GC failure is harmless).

### 4.2 Why the second pass is required, not optional

At accumulate-time we deliberately cannot know which linked identities will
be represented. Capturing node_id/login for everyone during pass 1 =
provisional identity persistence for overflow contributors (rejected, §2).
The only way to keep identity fields out of provisional storage while still
producing durable contributor rows is to observe identity **after** the
represented set is known — i.e., a second walk of the same scope.

Cost: pass 2 is another `history(path:)` walk of that scope at cost ≈1
pt/page (measured). Sum over scopes ≈ 2× total history spend — bounded, and
the skip optimization (all represented keys already resolved by an earlier
scope) makes typical builds cheaper.

**Resolve-drift edge case (stated honestly):** `author.user` is resolved by
GitHub at query time, not frozen at the pinned commit — a contributor can
unlink between pass 1 and pass 2 (account deleted, email relinked). Policy:
if a represented key resolves to `user = null` during pass 2, that key's
counts are folded into the **unlinked** bucket and finals are recomputed —
the truthful answer for the linkage state GitHub currently reports, exactly
what the one-shot reducer would emit had the stream shown null. If the key
remains *linked but never re-observed* in pass 2 (shouldn't happen under a
pinned revision — same commits), fail closed `OWNERSHIP_HISTORY_FAILED` and
retry once before erroring. The differential test (§12) does not simulate
live drift; equivalence holds against a fixed stream by construction.

### 4.3 first_seen_at / last_seen_at

Work rows keep min/max `committedDate` per (scope, key, month). At COMMIT:
contributor first/last = min/max over all the contributor's work rows across
all scopes (upsert `least`/`greatest` when a contributor is represented in
multiple scopes — contributor rows are repo-unique). This is value-identical
to the one-shot reducer's running min/max. No hidden problem — day-precision
is preserved; only the container changed.

### 4.4 Unlinked

All `author.user == null` nodes increment work rows with
`work_key='unlinked'` — one bucket, no per-author keys, no name/email ever
touched. Malformed present-but-broken identity still throws
`OwnershipIdentityError` → the page tx aborts → cursor doesn't advance →
error is surfaced via closed-taxonomy `OWNERSHIP_HISTORY_FAILED` and the
build stops (malformed identity is never silently reclassified). Retry
behavior for a persistent malformed node: the walk wedges at that cursor —
fail-closed by design, surfaced for a contract decision rather than skipped.

### 4.5 Bots

`is_bot` (login-suffix heuristic, pass 1) travels on the work row as a bare
boolean — the only way `human_contributor_count` can include/exclude
overflow contributors exactly without their logins.

---

## 5. Exactly-once checkpointing

### 5.1 The primitive — `own_checkpoint_page` (prospective 013 function)

A SQL function, `security invoker`, `EXECUTE → service_role` only, taking:

```
p_user, p_repository, p_version, p_scope,
p_expected_cursor, p_next_cursor, p_pass,
p_deltas jsonb        -- accumulate pass: [{period_start, work_key,
                      --   is_bot, touches, first_seen_at, last_seen_at}]
p_identities jsonb    -- resolve pass: [{work_key, github_node_id,
                      --   display_login, is_bot}]
```

One transaction, in order:

1. `SELECT ... FROM ownership_sync_state WHERE (user_id, repository_id) FOR UPDATE`
   — serializes all ownership work for the repo; row is also the lease record.
2. Verify: row exists, `building_version = p_version`, `phase='history'`,
   `current.scope_id = p_scope`, `current.pass = p_pass`,
   `current.cursor IS NOT DISTINCT FROM p_expected_cursor`.
3. On any mismatch → `RETURN 'stale'` — **no writes.** (Lease expiry is a
   caller concern, not a correctness gate.)
4. Apply `p_deltas`: set-valued upsert
   `ON CONFLICT (scope_id, calculation_version, period_start, work_key)
   DO UPDATE SET touch_commits = w.touch_commits + EXCLUDED.touch_commits,
   first_seen_at = least(w.first_seen_at, EXCLUDED.first_seen_at),
   last_seen_at = greatest(w.last_seen_at, EXCLUDED.last_seen_at)`.
   Apply `p_identities`: upsert `ownership_contributors` on
   `(repository_id, contributor_key)` refreshing `display_login`/`is_bot`.
   Enforce the work-row cap inside the same statement (count check → raise
   → abort → phase 'error' by caller).
5. `jsonb_set(history_cursor, '{current,cursor}', p_next_cursor)`.
6. Commit.

### 5.2 Proof of the two crash windows

**Invariant:** durable work state for scope S under version V always
reflects exactly the prefix of pages ending at durable cursor C.

- Inductive step: a transaction either aborts entirely (state = prefix at C,
  cursor still C — CASE B impossible: cursor cannot move without its deltas)
  or commits (state = prefix at C′, cursor C′ — CASE A impossible: deltas
  cannot land without the cursor moving). Postgres tx atomicity makes the
  intermediate state unobservable. ∎
- Retry after commit-with-lost-response: caller retries with
  `p_expected_cursor = C`. Stored cursor is C′ ≠ C → step 2 fails → `'stale'`,
  zero writes. The page's effects were applied exactly once — the retry is
  a read. ∎
- `touch_commits + delta` additive upserts are safe **only because** the CAS
  guarantees a delta batch can be applied at most once per cursor value —
  the rejected "write then advance" / "advance then write" orderings are
  exactly CASE A / CASE B.

Same CAS envelope protects COMMIT (expected "scope still current") and
promotion (expected "pending empty") — one mechanism everywhere.

---

## 6. Working-state bounds (hard guard, fail-closed)

Work rows exist only for the scope currently in `ACCUMULATE`/`RESOLVE`;
COMMIT deletes them before the next scope starts.

| Bound | Proposed limit | Rationale |
|---|---|---|
| Distinct `work_key` per scope | 10,000 | ~5× facebook/react's repo-wide contributor count for a *single scope* — absurdly generous |
| Work rows per scope | 100,000 | keys × active months; e.g. 1k contributors × 100 months. ~10 MB transient |
| Page delta rows | ≤100 | one GraphQL page |
| JSONB cursor size | ~1 KB | sha + uuid + cursor strings |

Breach → `phase='error'`, `error='OWNERSHIP_INTERNAL_ERROR'`, work rows
retained for operator inspection (backup-excluded, so they cost nothing
durable), deleted by the next build start or the TTL sweep. **Never**
silently partial — an over-cap scope is an error, not a folded result.

TTL/cleanup: rows with `calculation_version` ≠ current `building_version`,
or orphaning an aborted/cleared build, are deleted (a) at build start, (b)
by a periodic sweep of work rows whose repo has no matching building_version
or is gone — plus unconditional cascade on repo/user delete via the
composite FK.

---

## 7. Top-25 tie determinism

Work key **is** the final `contributor_key`. COMMIT loads work rows and runs
the identical comparator — `touch_commits desc, contributor_key asc` — over
the identical complete set (same pinned revision ⇒ same node stream ⇒ same
counts). Two rebuilds on the same pinned revision + same
`calculation_version` produce identical membership including rank-25 ties.
The differential test (§12) is the executable proof.

---

## 8. Required contract amendment (proposed, not live)

Recorded in the spec appendix as PROPOSED — effective only if the
implementation tranche is approved:

1. **Ephemeral pseudonymous working state** — §3 gains an explicit class:
   `EPHEMERAL build-scoped counters` — `contributor_key`-keyed
   (scope×month×key) counters + `is_bot` + first/last timestamps, existing
   only while `building_version` is set, excluded from backups, cascade-
   deleted, TTL-swept. **No GitHub identity fields on overflow
   contributors** — §6.4's durable-identity guarantee is unchanged.
2. **Second persisted SHA** — `history_cursor.pinned_oid` joins
   `last_processed_sha` as the only sanctioned SHAs (build boundary vs
   incremental anchor).
3. **Two-pass re-derivation** — `author.user.{id,login}` may be re-read in
   a resolve pass solely to populate durable contributor rows for
   already-represented keys.

Nothing else changes: no new identity fields, no finer granularity, no
relaxation of §5's prohibited list.

---

## 9. Backups & restore

- `ownership_history_work` → **EPHEMERAL** list in `backup-scope.mjs`
  (classification is mandatory — an unclassified table fails CI). Not in
  `BACKUP_TABLES`; never dumped.
- Verified against the assumption, not accepted on faith: losing work state
  costs a restarted scope — cheap. Putting it in dumps would store
  pseudonymous counters indefinitely for zero benefit. EPHEMERAL is correct.
- **Restore semantics:** restore brings back sync_state (OPERATIONAL) but no
  work rows. On resume the engine detects
  `building_version set ∧ work rows absent ∧ current scope mid-walk` →
  resets `current.cursor = null` (restart that scope's walk) — pages are
  re-fetched, CAS txs rebuild state, and no page can be double-applied
  because cursor/delta atomicity is per-transaction, not per-backup.
  `active_version` rows are untouched throughout.

---

## 10. Revision pinning — the second blocker

`defaultBranchRef.target` resolves **at query time**: page 1 can read HEAD@A
and page 40 HEAD@B after a push — silently mixing revisions inside one
scope's aggregates.

**Design:** resolve `defaultBranchRef.target.oid` once at build start
(cost-1 probe) → `pinned_oid` in `history_cursor` → every walk uses

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

Tree enumeration likewise pins: `object(oid:)` → `... on Commit { tree { oid } }`
then REST `git/trees/{tree_sha}?recursive=1` (the measured endpoint, now
sha-pinned).

- Retries always carry `pinned_oid` — same revision by construction.
- Force-push making the oid unresolvable → fail closed
  (`OWNERSHIP_HISTORY_FAILED`), `active_version` kept, next build re-pins.
  Never continue mid-build on a new HEAD — that mixes revisions.
- **Not measured in Phase 0.5.** `object(oid:)`/`object(expression:)` was
  used only for `blame` at literal `"HEAD"`. A pinned-oid `history(path:)`
  walk, pagination behavior under `object`, and unreachable-oid semantics
  (null vs `NOT_FOUND` error) are all unmeasured.
- **Gate: Phase 1C-B0.5 non-persisting spike** before implementation —
  same spike rigor (metadata-only queries, no writes): pinned-oid history
  walks + pagination, tree-sha enumeration, unreachable-oid behavior, cost
  confirmation, and live `author.user` resolution under a pinned commit.

---

## 11. Prospective migration 013 (DO NOT CREATE)

`013_ownership_checkpointing.sql` — additive only:

- `create table public.ownership_history_work` — columns per §3.4;
  composite FKs `(repository_id, user_id) → repositories`,
  `(scope_id, repository_id) → ownership_scopes(id, repository_id)`,
  all `on delete cascade`; unique `(scope_id, calculation_version,
  period_start, work_key)`; CHECKs on work_key shape and non-negative
  counts; `calculation_version > 0`.
- RLS enabled, zero policies; revoke browser roles; `service_role` DML only.
- `own_checkpoint_page(...)` — §5.1; `security invoker`, `EXECUTE →
  service_role`, all other grants revoked.
- `backup-scope.mjs`: append to `EPHEMERAL_TABLES` (same PR — CI requires it).
- Recovery-drill addition: assert the table exists post-migration and is
  **absent** from dumps.
- No changes to the four existing tables: phase enum already contains
  `history`; `resolve` is cursor-jsonb state, not a new phase; error
  taxonomy already covers the failure modes.

---

## 12. Differential correctness test (design)

`test/ownership-checkpoint-equivalence.test.mjs` (Phase 1C-B deliverable):

- **Harness:** one synthetic node stream per scope →
  (A) `reduceHistoryToMonthly` once → expected output.
  (B) simulated engine: partition the stream into pages; drive the
  checkpoint algorithm over the pages (in-memory stand-in implementing the
  same upsert/CAS semantics), then finalize → actual output.
- **Assert equality** on: per-month `total_touch_commits`,
  `touch_commits`/`touch_share` per contributor row,
  `human_contributor_count`, `unlinked_touch_share`, Top-25 membership
  (exact key sets), `other` counts/shares, the durable
  `contributor_candidates` set including `first_seen_at`/`last_seen_at`.
- **Adversarial pagination:** month spanning many pages; boundary splitting
  a month mid-contributor-run; a contributor crossing rank 25 on the final
  page; 30-way tie straddling rank 25; unlinked/bot nodes spread across
  pages; replay of an already-committed page (must no-op via stale cursor);
  simulated commit-success/response-lost; timeout between pages.
- The test fails if equivalence depends on pagination — that is the entire
  point of the mechanism.

---

## 13. Failure matrix

| Case | Durable state | Retried? | No double-count | No skip | Cleanup |
|---|---|---|---|---|---|
| Crash before GitHub response | cursor=C, state=prefix(C) | yes, refetch page | page never applied | cursor still C | — |
| Crash after response, before tx | same | yes | tx never ran | same | — |
| Tx commits, response lost | cursor=C′, state=prefix(C′) | retry sees C′≠C → 'stale' | CAS rejects re-apply | page is applied | — |
| Retry same page | — | returns 'stale' | no writes on stale | — | — |
| Rate limit before page | unchanged | resume from C | nothing applied | — | error=GITHUB_RATE_LIMIT, resume later |
| Rate limit after response | response already in hand → tx completes or crashes clean | — | tx atomic | — | — |
| Malformed identity in page | tx aborts; cursor stays C | wedges at C — fail closed | — | page never committed | error=OWNERSHIP_HISTORY_FAILED; operator decides |
| DB timeout before commit | abort | retry applies | — | — | — |
| DB timeout, unknown outcome | maybe committed | retry: cursor==C′ → 'stale' (applied) or C → apply (not) | exactly-once either way | — | — |
| Worker timeout | as crash cases | next worker | CAS | — | lease expiry §14 |
| Deploy during build | in-flight tx aborts or completes | next deploy resumes | CAS | — | code must be read-compatible (additive 013) |
| Gate off mid-build | rows persist harmlessly | no caller → nothing runs | — | — | TTL sweep / next enable |
| Repo disconnected mid-build | cascade unchanged; sync gate stops calls | no | — | — | build stalls; resume on reconnect |
| Repo deleted mid-build | FK cascade removes work+sync rows | n/a | — | — | cascade is total — nothing to clean |
| Installation revoked | tx state intact | fails at next fetch | CAS | — | error=GITHUB_ACCESS_REVOKED |
| Pinned revision disappears | pages error; cursor=C | retry once → fail closed | partial scope state retained but never served (building_version) | — | error=OWNERSHIP_HISTORY_FAILED; next build re-pins |
| calculation_version changed | old-version work rows orphaned | n/a | version-scoped unique keys | — | GC by version at next build / sweep |
| Stale concurrent worker | lease + CAS | loser gets 'stale' | CAS rejects second apply | — | lease takeover after expiry |
| CAS cursor mismatch | — | reload state, refetch from durable C | — | — | — |

---

## 14. Concurrency

- **Per-repo, not per-user.** `ownership_sync_state` row is the unit of
  contention — `user_sync` locking is untouched, so a huge ownership build
  can never starve the same user's normal sync.
- **Soft lease** (`history_cursor.lease = {owner, expires}`): a worker
  holds the build; a stale worker (expired lease) yields. Reduces wasted
  fetches, is not the correctness mechanism.
- **Correctness backstop:** `SELECT FOR UPDATE` + cursor CAS inside
  `own_checkpoint_page` — even two racing workers cannot double-apply.

---

## 15. Rate limit / slice budget

- ≤300 GraphQL pts per slice (spike recommendation — headroom for normal
  sync within the 5,000 pt/hr floor).
- Wall-clock deadline ~40 s inside the 45 s slice; stop only at page
  boundaries (a checkpoint is the only legal pause point).
- Count **measured** `rateLimit.cost` per page, not assumed 1 — stop when
  `remaining` < 500 or the budget is spent; persist nothing about
  rate limits beyond the closed `GITHUB_RATE_LIMIT` error code.
- Resume: next scheduled slice picks up at the durable cursor — no
  ownership-specific cron wiring in this design (runtime wiring is 1C-B's).

---

## 16. Decision standard — final answers

| Question | Answer | Basis |
|---|---|---|
| A. Buildable without migration 013? | **NO** | §1 — no existing table can hold per-contributor intermediate state within the contract |
| B. Temporary per-contributor state unavoidable? | **YES** | §0 — exact fold requires complete sets; multi-invocation walks lose memory |
| C. Fifth ephemeral table required? | **YES** | §3 — only D satisfies privacy + bound + backup + cascade simultaneously |
| D. Two-pass identity resolution required? | **YES** | §4.2 — the only way to keep overflow identity fields unpersisted |
| E. Fixed-revision history query required? | **YES** | §10 — `defaultBranchRef` drifts mid-build |
| F. Additional measured spike required? | **YES** | §10 — `object(oid:)` history is unmeasured |
| G. Exact Top-25 preserved? | **YES** | §7 — work key = contributor key, identical comparator |
| H. Overflow identity fields unpersisted? | **YES** | §4.2 — pass 2 captures only represented keys |
| I. Every page transition exactly-once? | **YES** | §5.2 — single-transaction CAS, proven |
| J. Work state backup-excludable safely? | **YES** | §9 — loss = restarted scope, never user data |

## 17. Readiness verdict

**Ready to IMPLEMENT Phase 1C-B: NO.** Three prerequisites, in order:

1. Approval of the §8 contract amendment (ephemeral pseudonymous work
   state + pinned build SHA in sync-state jsonb).
2. Phase 1C-B0.5 non-persisting spike measuring pinned-revision history
   walks, pinned tree enumeration, and unreachable-oid behavior.
3. Then: migration 013 + the engine implementation behind the existing
   hard-off gate.
