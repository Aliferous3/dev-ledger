#!/usr/bin/env node
// Ownership pinned-revision history spike — Phase 1C-B0.5.
//
// THIS SPIKE MUST NOT PERSIST OWNERSHIP DATA. Read-only GraphQL/REST calls only.
// No Supabase client is initialized; no database writes occur. Raw results
// are written only to the gitignored .tmp/ownership-pinned-spike/ directory.
// No tokens, private keys, source content, commit messages, or emails are
// ever printed or written. Private repo names are anonymized PRIVATE_* in
// console output and any committed artifact.
//
// Validates the §10 assumptions in docs/ownership-checkpoint-architecture.md:
//   Repository.object(oid: <commit_sha>) -> Commit -> history(path:, after:)
//   works as a multi-invocation, revision-pinned walk.
//
// Usage (installation token obtained exactly like the 0.5 spike):
//   GITHUB_APP_ID=<id> GITHUB_APP_PRIVATE_KEY_PATH=<pem> \
//     [GITHUB_INSTALLATION_ID=<id>] \
//     node scripts/spikes/ownership-pinned-history-spike.mjs
// Falls back to .env.local for GITHUB_APP_ID/GITHUB_CLIENT_ID when unset;
// installation id is discovered via the app JWT when not supplied.

import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  probeQuery,
  objectLookupQuery,
  pinnedHistoryQuery,
  headHistoryQuery,
  closedPrHeadsQuery,
  branchesQuery,
  assertNoSourceFields,
  assertResponseMetadataOnly,
} from './ownership/pinned-queries.mjs'
import { makeRepoLabeler } from './ownership/sanitize.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../../.tmp/ownership-pinned-spike')
const ENV_LOCAL = path.resolve(__dirname, '../../.env.local')

const PACE_MS = 350
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- credential wiring ----------------------------------------------------
// Fill gaps from .env.local (its private-key value is a placeholder; the
// real PEM always comes from GITHUB_APP_PRIVATE_KEY_PATH).
if (fs.existsSync(ENV_LOCAL)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(ENV_LOCAL, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v
  }
}
const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
if (keyPath) {
  const pem = fs.readFileSync(keyPath, 'utf8')
  // @octokit/auth-app's WebCrypto signer requires PKCS#8; normalize a
  // PKCS#1 PEM in memory when that is what the file holds.
  process.env.GITHUB_APP_PRIVATE_KEY = pem.includes('BEGIN RSA PRIVATE KEY')
    ? (await import('node:crypto')).createPrivateKey(pem)
        .export({ format: 'pem', type: 'pkcs8' })
        .toString()
    : pem
}
if (!process.env.GITHUB_APP_ID && process.env.GITHUB_CLIENT_ID) {
  process.env.GITHUB_APP_ID = process.env.GITHUB_CLIENT_ID
}

const { getInstallationOctokit, withBackoff } = await import('../../lib/github.mjs')
const { getAppOctokit } = await import('../../lib/auth.mjs')

async function resolveInstallationId() {
  if (process.env.GITHUB_INSTALLATION_ID) return Number(process.env.GITHUB_INSTALLATION_ID)
  const app = await getAppOctokit()
  const { data: installations } = await app.rest.apps.listInstallations({ per_page: 10 })
  if (!installations.length) throw new Error('no installations visible to app credentials')
  return installations[0].id
}

const INSTALLATION_ID = await resolveInstallationId()
const octokit = await getInstallationOctokit(INSTALLATION_ID)

const label = makeRepoLabeler()
const results = { meta: {}, tests: {}, warnings: [] }
let reqCount = 0

async function gql(query, vars, labelName) {
  assertNoSourceFields(query)
  const t0 = Date.now()
  let data, status = 200, err = null
  try {
    data = await withBackoff(() => octokit.graphql(query, vars), { tag: `spike.${labelName}` })
  } catch (e) {
    status = e?.status || 0
    err = `${e?.name}: ${String(e?.message || '').slice(0, 300)}`
  }
  const ms = Date.now() - t0
  reqCount++
  const rl = data?.rateLimit || null
  const leaked = data ? assertResponseMetadataOnly(data) : []
  if (leaked.length) results.warnings.push(`response contained forbidden keys: ${leaked}`)
  await sleep(PACE_MS)
  return {
    label: labelName, ok: !err, status, error: err, ms,
    cost: rl?.cost ?? null, remaining: rl?.remaining ?? null,
    data: data || null,
  }
}

async function rest(labelName, fn) {
  const t0 = Date.now()
  let data = null, status = 200, err = null, remaining = null
  try {
    const res = await fn()
    data = res.data
    status = res.status
    remaining = res.headers?.['x-ratelimit-remaining'] ?? null
  } catch (e) {
    status = e?.status || 0
    err = `${e?.name}: ${String(e?.message || '').slice(0, 200)}`
  }
  reqCount++
  await sleep(PACE_MS)
  return { label: labelName, ok: !err, status, error: err, ms: Date.now() - t0, remaining, data }
}

const oid = (r) => r?.data?.repository?.object?.oid ?? null
const historyOf = (r) => r?.data?.repository?.object?.history ?? null

// Walk pages of pinned history, one GraphQL request per page (separate
// requests by construction — this is the multi-invocation property).
async function walkHistory(owner, name, oidStr, { path: p = null, pages = 3, pinned = true } = {}) {
  const out = { pages: [], dupes: [], totalNodes: 0 }
  let cursor = null
  for (let i = 0; i < pages; i++) {
    const vars = pinned
      ? { owner, name, oid: oidStr, path: p, cursor }
      : { owner, name, path: p, cursor }
    const r = await gql(pinned ? pinnedHistoryQuery() : headHistoryQuery(),
      vars, `hist.${p ? 'path' : 'repo'}.${i + 1}`)
    const h = pinned ? historyOf(r) : r?.data?.repository?.defaultBranchRef?.target?.history
    const nodes = h?.nodes || []
    const seen = new Set(out.pages.flatMap((pg) => pg.nodes))
    out.dupes.push(...nodes.map((n) => n.oid).filter((o) => seen.has(o)))
    out.pages.push({
      i: i + 1, ok: r.ok, error: r.error, ms: r.ms, cost: r.cost,
      remaining: r.remaining, nodes: nodes.length,
      anchorOk: pinned ? (r.data?.repository?.object?.oid === oidStr) : null,
      firstOid: nodes[0]?.oid ?? null, lastOid: nodes[nodes.length - 1]?.oid ?? null,
      hasNextPage: h?.pageInfo?.hasNextPage ?? null,
      endCursor: h?.pageInfo?.endCursor ?? null,
      nodeOids: nodes.map((n) => n.oid),
      unlinked: nodes.filter((n) => !n.author?.user).length,
      linked: nodes.filter((n) => n.author?.user).length,
      userShapeOk: nodes.every((n) => n.author === undefined || n.author === null || 'user' in (n.author ?? {})),
    })
    out.totalNodes += nodes.length
    if (!r.ok || !h?.pageInfo?.hasNextPage) break
    cursor = h.pageInfo.endCursor
  }
  return out
}

async function run() {
  results.meta = {
    at: new Date().toISOString(),
    installationIdFound: Boolean(INSTALLATION_ID),
    paceMs: PACE_MS,
  }

  // ---- installation repo inventory (REST, metadata only) ------------------
  const reposRes = await rest('installation.repos', () =>
    octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 }))
  const repos = (reposRes.data?.repositories || [])
    .map((r) => ({ full: r.full_name, priv: r.private }))
  results.tests.repoInventory = { ok: reposRes.ok, count: repos.length }

  const publicCandidates = repos.filter((r) => !r.priv)
  const privateCandidates = repos.filter((r) => r.priv)

  // Public target: prefer a public repo in the installation (e.g. the
  // dev-ledger repo itself); fall back to facebook/react — a large public
  // repo, ideal for scale + HEAD-drift probing.
  const pubRepo = publicCandidates[0]?.full || 'facebook/react'
  // Private target: first private repo in the installation.
  const privRepo = privateCandidates[0]?.full || null

  const targets = [{ role: 'public', full: pubRepo, priv: false }]
  if (privRepo) targets.push({ role: 'private', full: privRepo, priv: true })

  for (const t of targets) {
    const [owner, name] = t.full.split('/')
    const tag = t.priv ? label(t.full, true) : t.full
    const T = (results.tests[t.role] = { repo: tag, private: t.priv })

    // TEST 1 — probe + pinned object lookup.
    const probe = await gql(probeQuery(), { owner, name }, `probe.${t.role}`)
    const headOid = probe.data?.repository?.defaultBranchRef?.target?.oid ?? null
    T.probe = { ok: probe.ok, error: probe.error, ms: probe.ms, cost: probe.cost, remaining: probe.remaining, headOid }
    if (!headOid) continue
    const lookup = await gql(objectLookupQuery(), { owner, name, oid: headOid }, `lookup.${t.role}`)
    T.objectLookup = {
      ok: lookup.ok, error: lookup.error, ms: lookup.ms, cost: lookup.cost,
      typename: lookup.data?.repository?.object?.__typename ?? null,
      resolvedOid: lookup.data?.repository?.object?.oid ?? null,
      treeOid: lookup.data?.repository?.object?.tree?.oid ?? null,
      matchesInput: lookup.data?.repository?.object?.oid === headOid,
    }

    // TEST 2 — pinned repo-wide history (multi-request walk).
    T.pinnedRepoWalk = await walkHistory(owner, name, headOid, { pages: 3 })

    // TEST 3 — pinned path-scoped history, path taken from the pinned
    // commit's own tree (see TEST pinned tree below; the path is chosen
    // there). Executed after the tree fetch further down.

    // TEST 4 — ancestor pinning (HEAD-moved-by-construction proof):
    // pick S = an older commit from the pinned walk (last node of page 1,
    // i.e., 100 commits behind HEAD at minimum) and walk it.
    const page1 = T.pinnedRepoWalk.pages[0]
    const anchorOid = page1?.lastOid || headOid
    const sLookup = await gql(objectLookupQuery(), { owner, name, oid: anchorOid }, `lookup.S.${t.role}`)
    const sOid = sLookup.data?.repository?.object?.oid ?? null
    T.anchorPin = { sOid: Boolean(sOid) }
    if (sOid) {
      const sWalk = await walkHistory(owner, name, sOid, { pages: 2 })
      const headWalk = await walkHistory(owner, name, headOid, { pages: 1, pinned: false })
      const headPage1 = new Set(headWalk.pages[0]?.nodeOids || [])
      const sFirst = sWalk.pages[0]?.nodeOids?.[0] ?? null
      T.anchorPin = {
        sOid: true,
        sFirstNodeEqualsS: sFirst === sOid,
        sFirstNodeInHeadPage1: headPage1.has(sOid),
        sWalkPages: sWalk.pages.map((p) => ({ nodes: p.nodes, cost: p.cost, firstOid: p.firstOid })),
        sDupes: sWalk.dupes,
        note: 'S is an ancestor of HEAD — a pinned walk at S must return S as its first node and must not surface commits younger than S.',
      }
      // Verify the pinned S walk surfaces NO commit newer than S that only
      // exists at HEAD: check overlap of S-walk oids with HEAD page-1 nodes
      // that are strictly newer (present in HEAD page 1 but absent from S).
      const headNodes = headWalk.pages[0]?.nodeOids || []
      const headOnlyNewer = headNodes.slice(0, headNodes.indexOf(sOid))
      const sAll = new Set(sWalk.pages.flatMap((p) => p.nodeOids))
      T.anchorPin.headOnlyNewerCount = headOnlyNewer.length
      T.anchorPin.headOnlyNewerLeakedIntoSWalk = headOnlyNewer.filter((o) => sAll.has(o)).length
    }

    // TEST 5 — cursor re-issue stability: refetch page 1 and page 2 of the
    // pinned repo-wide walk in fresh requests; identical oid sequences
    // required.
    const refetch1 = await walkHistory(owner, name, headOid, { pages: 1 })
    T.cursorStability = {
      page1Identical: JSON.stringify(refetch1.pages[0]?.nodeOids) === JSON.stringify(T.pinnedRepoWalk.pages[0]?.nodeOids),
      walkDupes: T.pinnedRepoWalk.dupes,
      pagesWalked: T.pinnedRepoWalk.pages.length,
      totalNodes: T.pinnedRepoWalk.totalNodes,
    }
    const p2 = T.pinnedRepoWalk.pages[1]
    if (p2?.nodes) {
      const refetch2 = await gql(pinnedHistoryQuery(),
        { owner, name, oid: headOid, path: null, cursor: T.pinnedRepoWalk.pages[0].endCursor },
        `hist.repo.2b.${t.role}`)
      const h2 = historyOf(refetch2)
      T.cursorStability.page2Identical =
        JSON.stringify((h2?.nodes || []).map((n) => n.oid)) === JSON.stringify(p2.nodeOids)
    }

    // TEST 6 — HEAD drift probe: re-resolve defaultBranchRef now and record;
    // the final probe at end of run gives the drift window.
    T.headReprobe = { oidAtStart: headOid }

    // TEST 7 — object(oid:) edge cases on this repo.
    const edge = {}
    const zeroRes = await gql(objectLookupQuery(), { owner, name, oid: '0'.repeat(40) }, `edge.zero.${t.role}`)
    edge.nonexistentOid = { ok: zeroRes.ok, error: zeroRes.error, typename: zeroRes.data?.repository?.object?.__typename ?? null, objectIsNull: zeroRes.data?.repository?.object === null }
    const randRes = await gql(objectLookupQuery(), { owner, name, oid: 'a'.repeat(40) }, `edge.rand.${t.role}`)
    edge.randomOid = { ok: randRes.ok, error: randRes.error, typename: randRes.data?.repository?.object?.__typename ?? null, objectIsNull: randRes.data?.repository?.object === null }
    T.objectEdges = edge

    // TEST 7b — commit on a non-default branch (unreachable from HEAD):
    // object(oid:) should still resolve it and history should anchor to it.
    const branches = await gql(branchesQuery(), { owner, name }, `branches.${t.role}`)
    const defaultName = probe.data?.repository?.defaultBranchRef?.name
    const otherRef = (branches.data?.repository?.refs?.nodes || [])
      .find((n) => n.name !== defaultName && n.target?.oid)
    if (otherRef) {
      const r = await gql(objectLookupQuery(), { owner, name, oid: otherRef.target.oid }, `lookup.altref.${t.role}`)
      const w = await walkHistory(owner, name, otherRef.target.oid, { pages: 1 })
      T.nonDefaultBranchCommit = {
        found: true,
        resolves: r.data?.repository?.object?.__typename === 'Commit',
        objectIsNull: r.data?.repository?.object === null,
        walkFirstNodeEqualsOid: w.pages[0]?.firstOid === otherRef.target.oid,
        walkNodes: w.pages[0]?.nodes ?? null,
        walkCost: w.pages[0]?.cost ?? null,
      }
    } else {
      T.nonDefaultBranchCommit = { found: false }
    }

    // TEST 8 — pinned tree oid -> REST recursive tree + tree-identity proof.
    const treeOid = T.objectLookup.treeOid
    if (treeOid) {
      const commitMeta = await rest(`commit.${t.role}`, () =>
        octokit.rest.repos.getCommit({ owner, repo: name, ref: headOid }))
      const headTreeViaCommit = commitMeta.data?.commit?.tree?.sha ?? null
      const headTree = await rest(`tree.head.${t.role}`, () =>
        octokit.rest.git.getTree({ owner, repo: name, tree_sha: headTreeViaCommit || headOid, recursive: 'true' }))
      const pinnedTree = await rest(`tree.pinned.${t.role}`, () =>
        octokit.rest.git.getTree({ owner, repo: name, tree_sha: treeOid, recursive: 'true' }))
      const entryKey = (tr) => JSON.stringify(
        (tr?.data?.tree || []).map((e) => `${e.path}:${e.sha}:${e.type}`).sort())
      T.pinnedTree = {
        treeOidMatchesHeadCommitTree: treeOid === headTreeViaCommit,
        headOk: headTree.ok, pinnedOk: pinnedTree.ok,
        headEntries: headTree.data?.tree?.length ?? null,
        pinnedEntries: pinnedTree.data?.tree?.length ?? null,
        pinnedTruncated: pinnedTree.data?.truncated ?? null,
        entrySetsEqual: entryKey(headTree) === entryKey(pinnedTree),
        pinnedError: pinnedTree.error, headError: headTree.error,
      }

      // TEST 9 — path-scoped pinned history on a top-level directory that
      // exists in the pinned tree.
      const dirEntry = (pinnedTree.data?.tree || []).find((e) => e.type === 'tree' && !e.path.includes('/'))
      if (dirEntry) {
        const pWalk = await walkHistory(owner, name, headOid, { path: dirEntry.path, pages: 2 })
        T.pinnedPathWalk = {
          pathClass: 'top-level directory (from pinned tree)',
          pages: pWalk.pages.map((p) => ({ nodes: p.nodes, cost: p.cost, hasNext: p.hasNextPage, ms: p.ms, anchorOk: p.anchorOk })),
          totalNodes: pWalk.totalNodes,
          dupes: pWalk.dupes,
        }
      }
    }
  }

  // TEST 8 — cross-repo oid: query the public repo's HEAD oid inside the
  // private repo (or vice versa) — object(oid:) must not resolve foreign
  // objects.
  if (pubRepo && privRepo) {
    const [o1, n1] = pubRepo.split('/')
    const [o2, n2] = privRepo.split('/')
    const pubHead = results.tests.public?.probe?.headOid
    const privHead = results.tests.private?.probe?.headOid
    if (pubHead) {
      const r = await gql(objectLookupQuery(), { owner: o2, name: n2, oid: pubHead }, 'edge.xrepo')
      results.tests.crossRepoOid = {
        ok: r.ok, error: r.error,
        objectIsNull: r.data?.repository?.object === null,
        typename: r.data?.repository?.object?.__typename ?? null,
      }
    }
    if (privHead) {
      const r = await gql(objectLookupQuery(), { owner: o1, name: n1, oid: privHead }, 'edge.xrepo2')
      results.tests.crossRepoOidReverse = {
        ok: r.ok, error: r.error,
        objectIsNull: r.data?.repository?.object === null,
        typename: r.data?.repository?.object?.__typename ?? null,
      }
    }
  }

  // TEST 11 — unreachable-ish commit: closed/merged PR head oids on the
  // public target (source branches may be deleted — commit still resolvable?)
  const pub = targets.find((x) => x.role === 'public')
  if (pub) {
    const [owner, name] = pub.full.split('/')
    const prs = await gql(closedPrHeadsQuery(), { owner, name }, 'prheads')
    const heads = (prs.data?.repository?.pullRequests?.nodes || []).map((n) => n.headRefOid).filter(Boolean)
    const checks = []
    for (const h of heads.slice(0, 3)) {
      const r = await gql(objectLookupQuery(), { owner, name, oid: h }, `prhead.${checks.length}`)
      checks.push({ ok: r.ok, error: r.error, typename: r.data?.repository?.object?.__typename ?? null, objectIsNull: r.data?.repository?.object === null })
    }
    results.tests.prHeadOids = { checked: checks.length, results: checks }
  }

  // TEST 12 — non-Commit oid: look up a blob + tree oid via object(oid:).
  {
    const [owner, name] = pub ? pub.full.split('/') : []
    const headOid = results.tests.public?.probe?.headOid
    if (pub && headOid) {
      const treeRes = await rest('tree.noncommit', () =>
        octokit.rest.git.getTree({ owner, repo: name, tree_sha: headOid, recursive: 'false' }))
      const entries = treeRes.data?.tree || []
      const blobSha = entries.find((e) => e.type === 'blob')?.sha
      const treeSha = entries.find((e) => e.type === 'tree')?.sha
      const nonCommit = {}
      if (blobSha) {
        const r = await gql(objectLookupQuery(), { owner, name, oid: blobSha }, 'edge.blob')
        nonCommit.blobOid = { ok: r.ok, typename: r.data?.repository?.object?.__typename ?? null, commitSpreadNull: (r.data?.repository?.object?.committedDate ?? null) === null, error: r.error }
      }
      if (treeSha) {
        const r = await gql(objectLookupQuery(), { owner, name, oid: treeSha }, 'edge.tree')
        nonCommit.treeOid = { ok: r.ok, typename: r.data?.repository?.object?.__typename ?? null, commitSpreadNull: (r.data?.repository?.object?.committedDate ?? null) === null, error: r.error }
      }
      results.tests.nonCommitOids = nonCommit
    }
  }

  // Final HEAD re-probe — did HEAD move during the walk window?
  for (const t of targets) {
    const [owner, name] = t.full.split('/')
    const T = results.tests[t.role]
    if (!T?.probe?.headOid) continue
    const r = await gql(probeQuery(), { owner, name }, `reprobe.${t.role}`)
    T.headReprobe.oidAtEnd = r.data?.repository?.defaultBranchRef?.target?.oid ?? null
    T.headReprobe.headMovedDuringRun = T.headReprobe.oidAtEnd !== T.headReprobe.oidAtStart
  }

  results.meta.requests = reqCount
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))

  // Console: compact summary only — raw detail (incl. private commit oids)
  // stays in the gitignored .tmp file.
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object') {
      const o = {}
      for (const [k, val] of Object.entries(v)) {
        if (['nodeOids', 'endCursor'].includes(k)) continue
        o[k] = strip(val)
      }
      return o
    }
    if (typeof v === 'string') return v.replace(/\b[0-9a-f]{40}\b/gi, (s) => `${s.slice(0, 7)}…`)
    return v
  }
  console.log(JSON.stringify(strip(results), null, 2))
}

run().catch((e) => {
  console.error('SPIKE FAILED:', e)
  process.exit(1)
})
