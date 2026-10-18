# RFC — Code Ownership Over Time

Status: draft — reconnaissance and design only. No production behavior changes in this document.

## 1. Executive recommendation

Dev Ledger can legitimately answer *"who appears to own or know which parts of this repository, and how has that changed over time?"* using **GitHub GraphQL metadata alone — no clone, no source blobs, no patches**.

Two capabilities make this possible and are already covered by the app's existing read-only `contents` permission:

- `Commit.blame(path:)` — surviving-line attribution per file at any revision, returned as line ranges + commit references. **No source text is returned or needed.**
- `Commit.history(path:)` — per-path (file or directory) commit history, returning author identity, timestamps, and stats. **No source text is returned or needed.**

Recommended V1 is a **contribution-weighted + last-touch ownership model at repository and directory granularity, sampled monthly**, plus an optional **HEAD-only surviving-line pass** for directories small enough to blame within a request budget. A single "bus factor score" should **not** ship in V1; concentration and maintainer-recency signals should be shown as separate, honest metrics.

The current public claim *"Dev Ledger does not clone or persist your repository source code"* survives literally under an API-only design, and the privacy posture holds — **but** the claim *"other people's contributions are never persisted"* does not: ownership is a multi-contributor metric by definition, and the schema/privacy wording must be amended deliberately (§6, §8).

## 2. Current architecture findings

Audited against `main` at `73e8b76`.

### 2.1 Identity and access

- Sign-in is GitHub OAuth with **no requested scopes** — `api/auth/login.mjs` sets only `client_id`, `redirect_uri`, `state`, `prompt`. No `repo`, no `user:email`. All repository access rides on GitHub App **installation tokens** minted on demand via `createAppAuth` (`lib/auth.mjs`, `lib/github.mjs`); tokens are never persisted.
- Publicly documented permissions (`src/security/SecurityPrivacyPage.tsx` §04): **Contents: read**, **Pull requests: read**, **Metadata: read**. The app is documented as read-only — it never writes to repositories.
- Webhooks (`api/webhooks/github.mjs`): `installation`, `installation_repositories`, `push`, `pull_request` — HMAC-verified, delivery-id deduplicated, only ever *mark work pending*; no writes to GitHub.

### 2.2 Ingestion model (the critical constraint)

`lib/sync.mjs` ingests commits through a single GraphQL `history` query (`HISTORY_QUERY`, line ~23) filtered by `author: { id: $author }` where `$author` is the signed-in user's `github_node_id`, plus a second `isAttributedCommit` check (`lib/analytics.mjs`). **Only the user's own commits are ingested; other contributors' commits never enter the pipeline.**

Stored per commit (`commitRow`, ~line 766): `user_id`, `repository_id`, `github_sha`, `committed_at`, `additions`, `deletions`. Nothing else.

**What is not available today:**

- File paths touched by a commit — the `files_changed` *count* column was dropped in `migrations/011_persistence_minimization.sql` and no path data is ever read.
- Other contributors' identities or commits.
- Diffs, patches, blobs, trees — zero usage anywhere in `lib/`, `api/` (verified by search: no blame/tree/blob/patch/archive/contents calls).
- Pull-request review data (only the user's own PRs are stored, minimal fields).

### 2.3 Sync/resume machinery (directly reusable)

- Staged phases `discover → metadata → commits → pulls`, resumable per-repository cursors in `repo_sync.cursor` (`{endCursor, since}`), coverage intervals in `repo_coverage` distinguishing "no activity" from "not yet synced".
- Time-sliced execution: 45 s user-driven slices (`api/sync.mjs`), 20 s cron slices (`api/cron/sync.mjs`), `waitUntil` continuations, CAS lock via `user_sync.locked_at` (90 s staleness), rate-limit → `status='rate_limited'` + `resume_at`.
- Push webhooks mark `repo_sync` rows for incremental work; incremental commit walks use `since = last_commit_at - 1h` overlap.

This is exactly the machinery an ownership pipeline needs: chunked, resumable, rate-limit-aware, with durable state.

### 2.4 Schema (post data-minimization)

`commits` holds only sha/timestamp/additions/deletions scoped to the user (`migrations/011` dropped `author_user_id`, `author_login`, `authored_at`, `files_changed`, `is_merge`; `008` dropped `message`). `pull_requests` is similarly minimal. RLS is enabled on every table; browser roles have no table access; all dashboard reads go through `security definer` SQL functions (`dash_*`) that never ship raw rows to the browser.

### 2.5 Public privacy claims that constrain this feature

From `src/security/SecurityPrivacyPage.tsx` and `docs/architecture.md`:

- "collect metrics, not source code" — preserved under API-only design.
- "Dev Ledger does not **clone or persist** your repository source code" — preserved by API-only design; an ephemeral clone would literally contradict "clone" (see §6).
- "Author identifiers are checked transiently during sync and never persisted … other people's contributions are never persisted" — **must be amended**: ownership requires storing derived per-contributor aggregates for people other than the signed-in user.
- "Commit messages are not stored" — preserved; no design here needs messages.
- "GitHub email addresses are not requested or stored" — preserved; blame/history can return email but we simply never select those fields.
- Deletion semantics ("DISCONNECT & DELETE", account deletion) must cascade to any new ownership tables.

## 3. GitHub data-access options

| Option | Permissions | Limits / cost | Depth | Source exposure | Verdict |
|---|---|---|---|---|---|
| GraphQL `history` (current) | contents:read | ~100 commits/request; 5,000 pts/hr per installation | Full default-branch history | None | Already in use; extend without `author` filter |
| GraphQL `history(path:)` | contents:read | Same; commits counted once per queried path | Full per-path history | None | **V1 workhorse** for directory contribution timelines |
| GraphQL `Commit.blame(path:)` | contents:read | One `blame` field per file per revision; batchable via aliases (existing `fetchLanguagesChunked` pattern); ranges can be large for big files | Blame at any commit-ish | None — returns ranges + commit refs only | **V1: HEAD-only blame**; historical snapshots too expensive (§11) |
| REST commit detail (`files[]`) | contents:read | 1 request/commit — 100k commits ≈ 20+ hr at 5,000 req/hr | Per-file adds/dels/patch per commit | Patch content transits memory (cannot be deselected) | Rejected as primary path; acceptable as small-repo fallback |
| Git trees API (`?recursive=1`) | contents:read | 1 request for whole tree (truncates >100k entries / 7MB) | HEAD listing only | Paths only | **Required** — file enumeration for blame batching |
| Archive tarball | contents:read | Whole snapshot per request | No history | Full source transits | Rejected — worse than clone, no history |
| Ephemeral local clone | contents:read | Clone size = repo size; needs disk + long runtime | Full | Full source touches worker disk | Viable but unnecessary for V1; see §6 privacy cost |
| REST blame | n/a | **Does not exist** | — | — | Not an option |

**Key facts:** no new GitHub permissions are required — blame, trees, and path-filtered history all sit under `contents:read`, which the app already holds. GraphQL's 5,000-point/hour installation budget is the binding constraint; blame fields are relatively cheap node-wise but must be budgeted like any other phase against the shared per-installation limit.

## 4. Ownership methodology comparison

| Method | What it measures | Needs source? | Accuracy profile | Cost to compute |
|---|---|---|---|---|
| **A. Surviving-line** (aggregated blame) | Who last authored each live line | No (blame API returns ranges only) | Strong "current familiarity" signal; penalizes removed work; skewed by formatters, moves, generated files | Blame per file per snapshot — O(files × snapshots) |
| **B. Contribution-weighted** | Who changed each path over history | No (`history(path:)` + commit stats) | Good "historical investment" signal; rewards deleted work; weaker for "who knows it now" | O(commits touched per dir) — cheap, incremental |
| **C. Recency-weighted** | Contribution × decay | No | Models knowledge decay; decay constant is arbitrary — present as weighting, not truth | Same as B plus a transform |
| **D. Hybrid** | Separate signals side-by-side | No | Most honest — shows disagreement instead of averaging it away | B + A at HEAD |

**Recommendation: D.** Present `surviving-line share`, `historical contribution share`, `recent contribution share`, and `last meaningful touch` as distinct numbers. Do not collapse into a single "expertise score" — competitors that do (single-number truck-factor outputs) are precisely the thing to avoid.

Renames: `blame` follows line content regardless of renames; `history(path:)` does **not** follow renames — a renamed file's history splits at the rename. Mitigation: aggregate at directory level where most renames stay inside the module; document residual error on cross-directory moves.

Squash merges attribute the squashed change to the squasher, not original authors — inherent to all Git-derived methods; disclose in methodology notes.

## 5. Recommended algorithm (V1)

**Per repository, per directory scope (`repo`, `dir/`, `dir/sub/`):**

1. Enumerate the HEAD tree once (recursive trees API); derive the directory set, excluding vendor/generated/binary-adjacent paths (§14 limits).
2. For each directory, walk `history(path: dir)` **without an author filter**; per commit record `contributor_key` (see §9), `committed_at`, `additions+deletions` — commits are repo-wide stats, so contribution weight = commit count + touched-share proxy; within a path-filtered walk, each listed commit touched that directory by definition.
3. Snapshot monthly (and at each release tag if tags are cheap to list): per dir × contributor, cumulative touch count and churn-weight to that date — produces the time series for free.
4. At HEAD only: batched `blame` per text file within each directory (alias-batched, budget-capped); aggregate ranges to directory-level surviving-line shares.
5. Incremental: on new pushes, extend each affected directory's walk with `since`; re-blame only files whose blob oid changed (tree comparison) or at most a capped N per cycle.

Outputs stay separate signals; the UI labels them as estimates.

## 6. Privacy impact

| Question | Answer under recommended design |
|---|---|
| Does source content have to be read? | **No.** Blame returns line ranges + commit refs; history returns commit metadata; trees return paths. `Blob.text` is never selected. |
| Does source leave GitHub? | No — API responses carry metadata only. (If REST `files[].patch` were ever used it transits memory unpersistable-by-choice; the recommendation avoids it.) |
| Source written to disk? | No — no clone, no archive. |
| Source persisted? | No. |
| What derived data is stored? | Per user/repo/dir/period/contributor: touch counts, churn weight, surviving-line share at HEAD, last-touch timestamps, contributor identity key + login label (§9). |
| Private repos different? | Same pipeline; RLS + tenant scoping apply identically. Installations already see only granted repos. |
| New GitHub permissions? | **None.** `contents:read` covers blame/trees/history. |
| New data category? | **Yes — other contributors' identities and contribution aggregates.** This is the one real privacy-model change. |

**Wording requiring amendment:**

- Security page "AUTHOR IDENTIFIERS" claim ("other people's contributions are never persisted") → becomes "other contributors' identities are stored only as derived ownership aggregates — never emails, never per-commit attribution rows for other people" or similar.
- `docs/architecture.md` data-model paragraph — same amendment.
- If an ephemeral clone is ever chosen (not recommended for V1), "does not clone" would need rewriting — avoid.

## 7. Security / threat model

Inputs are adversarial (any repo the installation can see):

- **Size bombs:** cap work — max directories analyzed (e.g., 500/repo), max files blamed per repo per cycle (e.g., 5,000, else sampled), max blame ranges processed, abort trees API on truncation flag.
- **Pathological trees:** deep nesting → collapse to max depth (suggest 4); pathological single dirs (node_modules, vendor, generated, minified) → exclusion list by pattern + heuristics (file count density, language=none).
- **Path traversal / weird filenames:** never write paths to disk, never build filesystem paths from them; store `path_hash` + normalized display path; treat all strings as inert data.
- **Symlinks/submodules:** tree entries with `type=commit` (submodules) or symlink mode — skip.
- **LFS/binary:** `Blob.isBinary` + extension/LFS-pointer heuristics — skip blame.
- **Malformed input:** GraphQL field-level failures per path — mark dir errored, resume via cursor.
- **Resource exhaustion:** reuse existing slice budget (45 s) and CAS lock; blame batches bounded per slice; per-repo checkpoint so a dead slice resumes.

## 8. GitHub permission impact

**None required.** All proposed reads (trees, blame, path-filtered history, tag listing for release snapshots) are covered by the existing read-only `contents` permission. No webhook additions needed — `push` already signals incremental work. App permission list on the security page stays accurate.

## 9. Data model

New tables (all RLS, `security definer` read functions, cascade on repo disconnect-delete and account delete):

```sql
ownership_contributor (          -- per repo: normalized identity
  id, user_id, repository_id, contributor_key,  -- opaque per-repo key
  github_user_id bigint null,   -- when GitHub links the author to an account
  display_login text null,      -- GitHub login for linked accounts; null = unlinked
  is_bot boolean, first_seen_at, last_seen_at
);

ownership_snapshot (             -- aggregate per repo × dir × period
  repository_id, user_id, scope_path_hash, scope_display_path,
  scope_type text,              -- 'repo' | 'dir'
  period_start timestamptz, period_granularity text,  -- 'month' | 'release' | 'head'
  contributor_key,
  touch_commits int, churn_weight bigint,             -- contribution signals
  surviving_lines bigint null,  -- only at granularity 'head'
  last_meaningful_touch timestamptz,
  calculation_version int, primary key (repository_id, scope_path_hash, period_start, contributor_key)
);

ownership_sync_state (           -- resumability, mirrors repo_sync
  repository_id, user_id, phase, cursor jsonb,        -- per-dir walk cursors
  blame_cursor jsonb, last_processed_at, error
);
```

Hard "do not store" list preserved: no source, no lines, no patches, no commit messages, no emails. `github_sha` of boundary commits only where needed for cursors.

## 10. Identity normalization

Priority for a commit's contributor:

1. `author.user.id` (linked GitHub account) → `display_login = login`, `github_user_id` stored.
2. Unlinked git identity → `contributor_key = hash(repository_id, normalized author name)`; `display_login = null`, rendered as "Unlinked: `<name-initial>`" or grouped "Unattributed". **Never store raw emails** — do not select `email` fields at all.
3. Bots: heuristic flag (`[bot]` login suffix, known bot logins) → `is_bot`, excludable in UI.
4. `.mailmap`: optional later pass — a single blob read of `/.mailmap` (source content of that one file transits memory, never persisted) improves merges; flag as a V1.5 decision because it is the only design element that touches file content.
5. Co-authored-by / pairing: GraphQL `authors` connection can list co-authors; V1 attributes to the primary author only, with a methodology note; co-author counting is a cheap V2 extension.

Renamed accounts resolve naturally — node id is stable and login is re-fetched. Squash-merge distortion is disclosed, not solved.

## 11. Historical sampling strategy

- **Contribution timeline (cheap):** monthly aggregation comes free from per-dir history walks — no extra calls. Ten years ≈ 120 period rows per dir per contributor — trivially storable.
- **Surviving-line over time (expensive):** blame at every monthly snapshot = files × snapshots calls (2k files × 60 months = 120k blame fields — rejected). Instead: blame at **HEAD always**, and optionally at **release tags** (bounded count, e.g., ≤24 tags). Position "ownership over time" primarily as contribution-share evolution; surviving-line is the *current* truth column.
- Adaptive: repos with <500 commits could afford quarterly blame snapshots behind a budget gate.

## 12. Incremental sync strategy

- Push webhook → mark `ownership_sync_state` dirty → next slice extends `history(path)` walks with `since` and updates the current period rows.
- Blame refresh: tree-diff since last processed commit — re-blame only changed-path files, capped per cycle; full re-blame quarterly or on `calculation_version` bump.
- `pushed_at ≤ last_processed_at` skip logic mirrors the commit sync's incremental path.

## 13. Failure / resume model

Checkpoints per repository: `{ dir_cursor: {path: endCursor}, blame_cursor: {next_file_index}, snapshot_cursor }` in `ownership_sync_state.cursor`. A mid-walk slice persists the GraphQL `endCursor` exactly like `walkHistory` today; a mid-blame slice persists the file index + tree sha. Rate-limit → `rate_limited` + `resume_at` (existing status taxonomy). A 5-hour-equivalent large-repo analysis degrades into ordered slices, each ≤45 s, none restarting completed dirs.

## 14. Scalability estimates

API calls (initial backfill), assuming ~500 top-level+module dirs and alias-batching at 20 fields/query:

| Repo | Commits | History calls (per-dir walks) | Blame calls | ~Total requests | Feasibility |
|---|---|---|---|---|---|
| Small <10k | <10k | ≈ dirs × pages; ≤500 | ≤5k files / 20 = 250 | <1k | trivial — one install's hourly budget |
| Medium 10–100k | 10–100k | ≤3k | 5k cap / 20 = 250 | ~3–4k | ~1 hr of budget; multi-slice over a session |
| Large 100k–1m | path-filtered walks still bounded by *commits touching each dir* | ≤15k | capped/sampled | ~10–20k | multi-hour, resumable; throttle-friendly |
| Very large 1m+ | same | ≤30k | sampled dirs only | ~20k+ | days across cron slices; offer opt-in per repo |

Memory/disk: everything is JSON-in/rows-out within existing function limits — no clone means no /tmp ceiling issue. Storage: dir×contributor×period rows; a 500-dir repo with 20 contributors × 120 months ≈ 1.2M rows worst case — prune cold periods (cohort monthly rows older than 2y into quarterly) or bound contributors to top-25 + "other".

## 15. UI information architecture

Recommendation: **a subview inside Code**, not a new top-level page. Code already owns repository anatomy (COMPOSITION / LANGUAGES / GROWTH / PROJECTS); `PAGE_SECTIONS.code` gains `OWNERSHIP` — consistent with the anchor-nav model in `src/components/RightSidebarNav.tsx`.

Views (V1 → later):

1. **Ownership Timeline** — stacked contributor-share bands per selected directory across monthly snapshots (contribution model).
2. **Repository Tree** — dir drill-down, top-3 contributors with shares, "other" bucket.
3. **Concentration** — dirs where one contributor > threshold; labeled "single-contributor coverage", not risk-scored.
4. **Recent Maintainers** — contributors with meaningful touches in the last 90 days vs historically dominant-but-inactive ("coverage gap", not "flight risk").
5. HEAD surviving-line column alongside contribution share where computed.

## 16. Ethical guardrails

- Tooltip/methodology copy on every ownership number: *"Ownership here is an estimate of historical contribution and familiarity — not proof of expertise, responsibility, or value."*
- No rankings, no per-person leaderboard view, no scores. Shares are shown per area, not per person across the product.
- Terminology: "coverage", "concentration", "recent activity" — never "risk", "expert", "best".
- Bots grouped separately; "unlinked" grouped as unattributed rather than guessing.

## 17. Bus factor decision

**Do not ship a single bus-factor number in V1.** Expose the honest inputs: number of meaningful contributors per dir, share of top contributor, count of recently-active maintainers. A derived estimate can come later behind `calculation_version`; the inputs must exist first anyway. This matches the site comparison page's stance (authorship alone cannot establish bus factor).

## 18. MVP scope

- Repo + directory levels only (no per-file view in V1).
- Signals: contribution share over time (monthly), HEAD surviving-line share (blame, budget-capped), last meaningful touch, contributor count, recent-maintainer count.
- Directory set bounded at 4 levels deep / 500 dirs; vendor/generated/binary/submodule exclusions.
- UI: Ownership Timeline + Repository Tree inside Code → `OWNERSHIP` anchor.
- No bus-factor score; no per-person roll-up; no CODEOWNERS generation.
- Privacy-doc amendments land in the same release train.

## 19. Phased roadmap

| Phase | Content | Notes |
|---|---|---|
| 0 | This RFC; privacy-page + architecture-doc amendment drafts; methodology disclosure page copy | docs-only, low risk |
| 1 | Schema (3 tables) + all-contributor path-filtered history ingestion + contributor normalization | biggest behavioral change: ingests other contributors' commit metadata |
| 2 | Monthly contribution aggregates + `dash_ownership_*` functions + API payload | pure SQL/worker work |
| 3 | Code-page OWNERSHIP section (timeline + tree) | UI only |
| 4 | HEAD blame pass (batched, capped) + surviving-line column | optional V1 tail |
| 5 | Release-tag blame snapshots, mailmap normalization, co-author counting | V2 candidates |

## 20. SEO / content activation plan (post-launch only)

After the feature ships, the Wave-2 pages can flip their disclaimers to product language:

- `/answers/how-to-track-code-ownership-over-time` — "Where Dev Ledger fits" becomes a real section.
- `/guides/git-code-ownership` — add worked Dev Ledger examples.
- `/glossary/code-ownership`, `/glossary/bus-factor` — keep definitional; update the Dev Ledger note.
- `/comparisons/best-code-ownership-tools` — Dev Ledger row gains real Yes cells (contribution-weighted ownership, over time, local-free hosted).
- New commercial page `/tools/code-ownership-over-time` joins the tools collection and sitemap/llms.txt.

Do **not** edit these until the feature is live — accuracy is the asset.

## 21. Blockers / open questions

1. **Privacy-model amendment is the real gate** — persisting other contributors' identities (even as GitHub logins) requires deliberate sign-off on the security-page wording, before any ingestion code.
2. **GraphQL blame cost at scale is unmeasured** — needs a spike against a real 5k-file repo to price alias-batched blame fields against the 5,000-pt/hr installation budget.
3. **Path-filtered history on huge repos is unmeasured** — a 500k-commit monorepo walk needs a spike to confirm per-dir walks stay bounded.
4. **`.mailmap` normalization** requires reading one file's content — decide whether that crosses the "never source" line or is an acceptable single-file exception (recommendation: skip in V1).
5. **Cross-directory renames** undercount historical contribution for moved modules; quantify the error or disclose it.
6. **Forks/mirrors**: whether ownership should compute on forked repos is a product decision (default: yes, scoped to what the installation sees).
7. Whether directory-level contribution-share time series satisfy the "ownership over time" promise without per-file surviving-line history is a product-call worth validating on 2–3 real repos before Phase 3 UI work.
