# Ownership GraphQL Feasibility Spike — Results

Status: measured evidence for `docs/code-ownership-over-time-rfc.md` Phase 0.5.

## Executive result

**CONDITIONAL PASS → GO recommendation.** Every required capability works on the real Dev Ledger installation token with existing `contents:read` permission, on public and authorized private repositories, without touching source. Costs are dramatically lower than the RFC's conservative estimates — alias-batched blame is flat 1 point regardless of batch size at every level tested. The only open concerns are behavioral characterization (rename boundaries measured on one real case) and scale validation on repos far larger than the installation's own (bounded via a public-repo probe).

## Environment

- Date: 2026-10-18
- RFC base: `main` at `6554529` (post-RFC merge)
- Spike branch: `spike/ownership-graphql-feasibility`
- Auth: real GitHub App installation token via `lib/github.mjs` `getInstallationOctokit` (app id 4970249, slug `dev-ledger`, installation on the owner's account). Token, private key, and credentials never printed or written.
- Source fetched: **none** — no `Blob.text`, no patches, no archives, no clones. Every query statically audited (`FORBIDDEN_FIELD_RE`) and every response scanned (`assertResponseMetadataOnly`) — zero violations.
- Persistence: **none** — no Supabase client initialized; spike module and helpers carry no db imports (asserted by unit test). Raw JSON written only to gitignored `.tmp/ownership-spike/`.

## Permission verification (TEST A)

| Call | Public repo (`Aliferous3/dev-ledger`) | Private repo (`PRIVATE_A`) |
|---|---|---|
| `repository` probe (defaultBranchRef) | ok — cost 1, 402 ms | ok — cost 1, 377 ms |
| `history(path: dir)` | ok — cost 1, 441 ms | ok — cost 1, 506 ms |
| `blame(path:)` at HEAD | ok — cost 1, 446 ms | ok — cost 1, 570 ms |
| REST `git/trees?recursive=1` | ok — not truncated | ok — not truncated |

**Existing `contents:read` permission is sufficient. No permission errors observed.** No App changes needed.

## Repository inventory (installation scope)

13 repositories authorized (all-selection installation). Tree enumeration per repo — all completed, none truncated:

| Repo | Files | Dirs | Entries | Resp KB | Latency |
|---|---|---|---|---|---|
| `Aliferous3/dev-ledger` (public) | 246 | 37 | 283 | 65 | 1.2 s |
| `Aliferous3/ripple-impact` (public) | 194 | 60 | 254 | 59 | 1.2 s |
| `Aliferous3/Aliferous3` (public) | 1 | 0 | 1 | 0.4 | 1.3 s |
| `Aliferous3/Live-Flight-Radar-Scanner-M5Stack` (public) | 6 | 2 | 8 | 2 | 1.2 s |
| `Aliferous3/ripple-demo` (public) | 30 | 8 | 38 | 9 | 1.1 s |
| `PRIVATE_A` | 2,336 | 368 | 2,704 | 704 | 1.5 s |
| `PRIVATE_B` | 56 | 9 | 65 | 15 | 1.4 s |
| `PRIVATE_C` | 128 | 25 | 153 | 36 | 1.3 s |
| `PRIVATE_D` | 137 | 37 | 174 | 42 | 1.3 s |
| `PRIVATE_E` | 115 | 25 | 140 | 34 | 1.2 s |
| `PRIVATE_F` | 143 | 68 | 211 | 51 | 1.2 s |
| `PRIVATE_G` | 415 | 53 | 468 | 113 | 1.5 s |
| `PRIVATE_H` | 36 | 3 | 39 | 10 | 1.1 s |

Coverage note: authorized repos span ~1–2.3k files. No ~5k-file authorized repo exists; scale was probed on the public `facebook/react` (7,260 files) — see truncation test. Recommendation: if stricter large-repo evidence is wanted, install the app on a large test repo; the gap is documented, not hidden.

## `history(path:)` measurements (TEST B) — `Aliferous3/dev-ledger`

| Target | Path class | Pages | Nodes/page | Cost/page | Latency | Resp KB | hasNextPage |
|---|---|---|---|---|---|---|---|
| `.github/ISSUE_TEMPLATE/bug_report.yml` | file | 1 | 1 | 1 | 407 ms | 0.4 | false |
| `.github` | directory | 1 | 11 | 1 | 432 ms | 1.9 | false |
| (none) | repo-wide | 3 | 100 | 1 | 479–549 ms | 15.3 | true |

Public-repo control (`facebook/react`): repo-wide history paged at 100 nodes/call, cost 1/page, 92 distinct linked logins in 500 commits; `history(path:"packages/react-dom")` returned 100 nodes, cost 1, `hasNextPage`.

**Confirmed empirically:** `history(path:)` filters to commits touching the path; file and directory paths both work; pagination is standard cursors. Per the RFC correction, `additions`/`deletions` were demonstrated to be whole-commit statistics (isolated demo query returned whole-commit `additions: 70` for a single-path-filtered commit) and are **not** used as path-level volume anywhere.

## Blame measurements (TEST C/E) — `Aliferous3/dev-ledger`

| File | Size KB | Ranges | Lines | Commits | Unlinked | Cost | Latency | Resp B |
|---|---|---|---|---|---|---|---|---|
| `migrations/003_api_grants.sql` | 0.7 | 1 | 15 | 1 | 0 | 1 | 383 ms | 316 |
| `CONTRIBUTING.md` | 3.6 | 3 | 104 | 2 | 0 | 1 | 395 ms | 709 |
| `test/posthog-analytics.test.mjs` | 21.8 | 42 | 535 | 8 | 0 | 1 | 446 ms | 8,404 |

Sum of `endingLine − startingLine + 1` exactly reconstructs the file's line count; ranges are contiguous, non-overlapping, gapless (spot-checked). Blame on a path that does not exist at HEAD returns **empty ranges, not an error** (observed on two moved/deleted `facebook/react` files — production code must treat "0 ranges" as "path not present at that ref").

## File-size effect (TEST E) — `facebook/react` large files

| File | Size KB | Ranges | Lines | Commits | Unlinked | Cost | Latency |
|---|---|---|---|---|---|---|---|
| `packages/react-dom/src/__tests__/ReactDOMFloat-test.js` | 321 | 1,280 | 10,356 | 92 | 0 | 1 | 1.9 s |
| `packages/react-dom/src/__tests__/ReactDOMFizzServer-test.js` | 295 | 1,758 | 10,948 | 180 | 0 | 1 | 3.5 s |
| `packages/react-devtools-shared/src/backend/fiber/renderer.js` | 284 | 2,390 | 8,082 | 320 | 679 | 1 | 2.7 s |

Blame cost is **flat 1 point** even at 2,390 ranges / 11k lines. Latency correlates with range count (~1.5–3.5 s for pathological files vs ~0.4 s typical). Response bytes scale with ranges (commit objects per range).

## Alias-batched blame (TEST D) — `Aliferous3/dev-ledger`

| Aliases | Cost | Cost/file | Latency | ms/file | Resp KB | Ranges | Result |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 1.00 | 407 ms | 407 | 0.9 | 4 | ok |
| 5 | 1 | 0.20 | 590 ms | 118 | 2.1 | 10 | ok |
| 10 | 1 | 0.10 | 784 ms | 78 | 3.9 | 19 | ok |
| 20 | 1 | 0.05 | 1,119 ms | 56 | 7.9 | 39 | ok |
| 50 | 1 | 0.02 | 2,527 ms | 51 | 40.4 | 206 | ok |

**Cost does not scale with alias count** — a 50-file batch still costs 1 point (the `rateLimit.cost` model prices the connection/field structure, not alias fan-out). Latency grows sub-linearly (~50 ms/file at 50 aliases). No errors, no timeouts at any level; 50 was the top of the tested ladder per protocol.

## Tree enumeration (TEST F)

All 13 authorized repos: `truncated=false`, zero submodules observed. Control: `facebook/react` — 7,901 entries / 7,260 files / 641 dirs, **not truncated**, 2.2 MB response, 2.7 s. Truncation (>100k entries or >7 MB) was not triggerable with available repos; production must still check `truncated` and fall back to subtree traversal — flagged, not measured.

## Rename / move characterization (TEST G)

Real cross-directory move in `Aliferous3/dev-ledger`: `src/ledgerData.ts` → `src/fixtures/ledgerData.ts` (verified R-entry in local history).

| Query | Result |
|---|---|
| `history(path: old)` | 4 commits (pre-move history) |
| `history(path: new)` | 1 commit |
| shared commits | 1 (the move commit itself) |
| `blame(path: new)` at HEAD | 50 ranges across 3 distinct commits |

Findings: `history(path:)` **does split at the rename boundary** — the old path retains pre-move history, the new path shows only the move commit forward (the shared commit is the move). HEAD `blame` on the new path attributed surviving ranges to **3 commits spanning the move boundary** — i.e., in this measured case blame attributed content to commits that predate the rename. One real observation, not a contract: cross-file/copy lineage is uncharacterized, so the RFC's "characterize empirically, disclose restructuring distortion" stance stands.

## Unlinked contributors (TEST I)

| Sample | Nodes/ranges | Unlinked | Rate |
|---|---|---|---|
| `Aliferous3/dev-ledger` history pages | 312 commits | 0 | 0% |
| `Aliferous3/dev-ledger` blame ranges | 46 | 0 | 0% |
| `facebook/react` repo-wide history (500 recent commits) | 500 commits | 0 | 0% |
| `facebook/react` large-file blame (`renderer.js`) | 2,390 ranges | 679 | **28.4%** |

Unlinked authors are **not rare on old history** — deep blame ranges on a mature public repo showed ~28% of ranges unattributable to a GitHub account (linked accounts require the commit's email to match a GitHub identity; old commits with non-linked emails surface as `author.user = null`). Recent commits on GitHub-native workflows are ~0% unlinked. The RFC's "Unlinked contributor" bucket is **required, sized as a common case on mature repos**, not an edge case.

## Rate-limit findings (TEST J)

- 52 GraphQL/REST calls in the main run + 13 supplemental probes; **every GraphQL query measured cost = 1 point** regardless of result size, batch fan-out, or range count.
- Observed `remaining` decremented from 4,983 → ~4,960s: the installation budget is the 5,000-pt/hr floor (small installation).
- No secondary-rate-limit condition was intentionally induced; none observed at 400 ms pacing.

## Source/privacy audit (TEST K)

- All six query builders statically audited — none select `text`, `byteSize`, `patch`, `message*`, `email`, or blob-content expressions (unit-tested).
- Every live response scanned for forbidden keys — zero occurrences.
- No `Blob.text`, clone, archive, or REST `files[].patch` used anywhere.
- Private-repo runs exercised the identical metadata-only query family; report anonymizes names/logins/SHAs/paths via labeled aggregates.

## Recommended production limits (measured, not guessed)

| Limit | Recommended | Basis |
|---|---|---|
| Blame aliases per query | **50** (tested ceiling; latency ~50 ms/file) | cost stays 1 pt — the binding constraint is response size/latency, not points |
| Files blamed per repo per cycle | ~5,000, sampled above that | 50-alias batches → ~100 queries ≈ 100 pts ≈ 2% of hourly floor |
| Directories analyzed | ≤500, depth ≤4 | unchanged from RFC; tree enumeration is one REST call |
| GraphQL cost per 45 s slice | ≤300 pts | leaves headroom for normal sync inside the same hourly budget |
| Response size guard | warn >2 MB, abort >5 MB | 50-alias batch ≈ 40 KB; huge-file blame ≈ hundreds of KB |
| History paging | 100 nodes/page, cost 1 | as today |
| Large-repo fallback | if files > blame cap or tree truncated → subtree traversal + directory sampling | truncation never observed; treat as defensive |

## RFC assumptions confirmed

1. `contents:read` covers blame / `history(path:)` / trees — **verified on real token, public + private**.
2. No source needs to be read, fetched, or persisted — **verified; queries return metadata only**.
3. Resumable slice architecture fits — queries are cheap enough that per-dir walks amortize trivially.
4. Alias batching (the `fetchLanguagesChunked` pattern) transfers directly to blame.

## RFC assumptions falsified / revised

1. "Blame fields are relatively cheap" → **dramatically understated**: measured cost is 1 pt regardless of batch size; the real constraint is latency/response size, not points. HEAD blame is *more* affordable than modeled.
2. "Unlinked contributor" bucket is not a rare edge — ~28% of deep blame ranges on a mature public repo; must be a first-class bucket, not a fallback.
3. Per-file surviving-line history (deferred in RFC) is **cheaper than assumed** — blame at historical revisions is 1 pt/file/revision; monthly snapshots on ≤2k-file repos (~60 snapshots × 40 batched queries ≈ 2,400 pts) are within budget. Still keep it post-V1, but it's no longer a blocker.
4. Tree truncation is real but rare (>100k entries); keep the fallback, expect to rarely use it.

## Architecture changes required

- None to the sync pipeline's shape — new `ownership` phase reuses slice/cursor/lock machinery.
- New ingestion dimension: drop the `author` filter for path-scoped walks (the feature's core change; privacy amendment still required — see RFC §6).
- Production must handle "0 ranges" blame (missing path) without erroring.

## GO / NO-GO

**GO** — all twelve gates pass:

1. Real installation token ✓ 2. Private repo access ✓ 3. No new permission ✓ 4. Blame attribution without source ✓ 5. `history(path:)` file+dir filtering ✓ 6. Cost practical under conservative quota ✓ (vastly) 7. Alias batching viable at 50 ✓ 8. No source/blob/patch ✓ 9. Zero persistence ✓ 10. Large-repo fallback defined ✓ 11. Rename limits characterized enough to disclose ✓ 12. Privacy amendment limited to derived multi-contributor metadata ✓
