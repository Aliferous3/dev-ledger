#!/usr/bin/env node
// Ownership GraphQL feasibility spike — RFC Phase 0.5.
//
// THIS SPIKE MUST NOT PERSIST OWNERSHIP DATA.
// No Supabase client is initialized; no database writes occur. Results are
// written only to the gitignored .tmp/ownership-spike/ directory. No tokens,
// private keys, source content, patches, or emails are ever printed or
// written.
//
// Usage (real installation token required):
//   GITHUB_APP_ID=<app-id-or-client-id> \
//   GITHUB_APP_PRIVATE_KEY_PATH=<path-to-pem> \
//   GITHUB_INSTALLATION_ID=<id> \
//   node scripts/spikes/ownership-graphql-spike.mjs
//
// Authentication reuses the production helpers in lib/github.mjs — env vars
// are set before the dynamic import so lib/config.mjs picks them up.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  historyPathQuery,
  blameQuery,
  batchedBlameQuery,
  repoProbeQuery,
  wholeCommitStatsDemoQuery,
  tagsQuery,
  assertNoSourceFields,
  assertResponseMetadataOnly,
  FORBIDDEN_FIELD_RE,
} from './ownership/queries.mjs'
import { makeRepoLabeler, summarizeBlameRanges } from './ownership/sanitize.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../../.tmp/ownership-spike')

const PACE_MS = 400
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- credential wiring (env before import so lib/config.mjs reads it) ----
const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
if (keyPath && !process.env.GITHUB_APP_PRIVATE_KEY) {
  process.env.GITHUB_APP_PRIVATE_KEY = fs.readFileSync(keyPath, 'utf8')
}
if (!process.env.GITHUB_APP_ID && process.env.GITHUB_CLIENT_ID) {
  process.env.GITHUB_APP_ID = process.env.GITHUB_CLIENT_ID // iss accepts client id
}
const INSTALLATION_ID = Number(process.env.GITHUB_INSTALLATION_ID || 0)
if (!INSTALLATION_ID) {
  console.error('GITHUB_INSTALLATION_ID required')
  process.exit(2)
}

const { getInstallationOctokit, withBackoff } = await import('../../lib/github.mjs')

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
    err = `${e?.name}: ${String(e?.message || '').slice(0, 200)}`
  }
  const ms = Date.now() - t0
  reqCount++
  const rl = data?.rateLimit || null
  const leaked = data ? assertResponseMetadataOnly(data) : []
  if (leaked.length) results.warnings.push(`response contained forbidden keys: ${leaked}`)
  await sleep(PACE_MS)
  return {
    label: labelName, ok: !err, status, error: err, ms,
    cost: rl?.cost ?? null, remaining: rl?.remaining ?? null, resetAt: rl?.resetAt ?? null,
    responseBytes: data ? Buffer.byteLength(JSON.stringify(data)) : 0,
    data: data || null,
  }
}

function splitRepo(fullName) {
  const [owner, name] = fullName.split('/')
  return { owner, name }
}

// Enumerate HEAD tree (TEST F) — returns { entries, files, dirs, truncated, bytes, ms }
async function treeOf(fullName) {
  const { owner, name } = splitRepo(fullName)
  const t0 = Date.now()
  const { data: repo } = await octokit.rest.repos.get({ owner, repo: name })
  const sha = repo.default_branch
  const res = await octokit.rest.git.getTree({ owner, repo: name, tree_sha: sha, recursive: 'true' })
  reqCount += 2
  const tree = res.data.tree || []
  const files = tree.filter((e) => e.type === 'blob')
  const dirs = new Set(files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))
  await sleep(PACE_MS)
  return {
    defaultBranch: sha,
    entries: tree.length,
    files: files.length,
    dirs: dirs.size,
    truncated: Boolean(res.data.truncated),
    submodules: tree.filter((e) => e.type === 'commit').length,
    bytes: Buffer.byteLength(JSON.stringify(res.data)),
    ms: Date.now() - t0,
    filePaths: files.map((f) => ({ path: f.path, size: f.size ?? null, mode: f.mode })),
  }
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|md|html|json|yml|yaml|py|go|rs|sql|txt)$/i

async function run() {
  results.meta = {
    date: new Date().toISOString(),
    node: process.version,
    installationId: 'redacted-present',
    auth: 'GitHub App installation token via lib/github.mjs',
    sourceFetched: false,
    persistence: 'none — no Supabase client initialized',
  }

  // ---- repository inventory (installation-scoped) -----------------------
  const { data: repoList } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 })
  reqCount++
  const repos = repoList.repositories.map((r) => ({
    full_name: r.full_name, private: r.private, pushed_at: r.pushed_at,
  }))
  results.meta.repoCount = repos.length

  // trees for every authorized repo to pick size classes (paths kept raw-local only)
  const trees = {}
  for (const r of repos) {
    try {
      trees[r.full_name] = await treeOf(r.full_name)
    } catch (e) {
      trees[r.full_name] = { error: String(e?.message || e).slice(0, 120) }
    }
  }
  results.tests.trees = Object.fromEntries(
    Object.entries(trees).map(([fn, t]) => [
      label(fn, repos.find((r) => r.full_name === fn)?.private ?? true),
      { ...t, filePaths: undefined }, // raw filePaths stay in the raw file only
    ]),
  )
  results._rawTrees = trees // internal: not for committed report

  // pick test set: largest public repo = medium probe; any private repo = privacy probe
  const byFiles = (a, b) => (trees[b]?.files || 0) - (trees[a]?.files || 0)
  const publicRepos = repos.filter((r) => !r.private && trees[r.full_name]?.files).sort((a, b) => byFiles(a.full_name, b.full_name))
  const privateRepos = repos.filter((r) => r.private && trees[r.full_name]?.files).sort((a, b) => byFiles(a.full_name, b.full_name))
  const pubMain = publicRepos[0]?.full_name
  const pubSmall = publicRepos[publicRepos.length - 1]?.full_name
  const privMain = privateRepos[0]?.full_name
  results.meta.testRepos = { publicMain: pubMain, publicSmall: pubSmall, privateMain: label(privMain, true) }

  // ---- TEST A — permission verification --------------------------------
  results.tests.permission = {}
  for (const repo of [pubMain, privMain].filter(Boolean)) {
    const { owner, name } = splitRepo(repo)
    const tag = repo === privMain ? 'private' : 'public'
    const rl = label(repo, repo === privMain)
    const probe = await gql(repoProbeQuery(), { owner, name }, `probe.${tag}`)
    const firstFile = trees[repo]?.filePaths?.find((f) => TEXT_EXT.test(f.path))?.path
    const firstDir = trees[repo]?.filePaths?.map((f) => f.path.split('/')[0]).find(Boolean)
    const hist = await gql(historyPathQuery(), { owner, name, path: firstDir || null }, `histDir.${tag}`)
    const bl = firstFile
      ? await gql(blameQuery(), { owner, name, path: firstFile }, `blame.${tag}`)
      : { skipped: 'no text file' }
    results.tests.permission[tag] = {
      repo: rl,
      probe: { ok: probe.ok, cost: probe.cost, ms: probe.ms },
      historyDir: { ok: hist.ok, error: hist.error, nodes: hist.data?.repository?.defaultBranchRef?.target?.history?.nodes?.length ?? null, cost: hist.cost, ms: hist.ms },
      blame: { ok: bl.ok ?? null, error: bl.error ?? null, ranges: bl.data?.repository?.object?.blame?.ranges?.length ?? null, cost: bl.cost ?? null, ms: bl.ms ?? null, file: firstFile || null },
      tree: { ok: !trees[repo]?.error, truncated: trees[repo]?.truncated ?? null },
    }
  }

  // ---- TEST B — history(path:) on the medium public repo ----------------
  if (pubMain) {
    const { owner, name } = splitRepo(pubMain)
    const filePaths = (trees[pubMain]?.filePaths || []).filter((f) => TEXT_EXT.test(f.path))
    const oneFile = filePaths.find((f) => f.path.includes('/'))?.path || filePaths[0]?.path
    const topDir = filePaths.map((f) => f.path.split('/')[0]).filter((d) => filePaths.some((f) => f.path.startsWith(d + '/')))[0]
    const histTargets = { file: oneFile, dir: topDir, whole: null }
    results.tests.history = {}
    for (const [kind, p] of Object.entries(histTargets)) {
      const pages = []
      let cursor = null
      for (let pg = 0; pg < 3; pg++) {
        const r = await gql(historyPathQuery(), { owner, name, path: p, cursor }, `hist.${kind}.p${pg}`)
        const h = r.data?.repository?.defaultBranchRef?.target?.history
        const nodes = h?.nodes || []
        const unlinked = nodes.filter((n) => !n.author?.user).length
        pages.push({ ok: r.ok, error: r.error, nodes: nodes.length, unlinkedAuthors: unlinked, cost: r.cost, remaining: r.remaining, ms: r.ms, bytes: r.responseBytes, hasNextPage: h?.pageInfo?.hasNextPage ?? null })
        if (!h?.pageInfo?.hasNextPage || !r.ok) break
        cursor = h.pageInfo.endCursor
      }
      results.tests.history[kind] = { pathClass: p ? (p === topDir ? 'dir' : 'file') : 'repo-wide', path: p, pages }
    }
    // isolated whole-commit stats demo (labeled; values not used anywhere)
    const demo = await gql(wholeCommitStatsDemoQuery(), { owner, name, path: oneFile }, 'wholeCommitDemo')
    results.tests.history.wholeCommitStatsDemo = {
      ok: demo.ok,
      sampleWholeCommitAdditions: demo.data?.repository?.defaultBranchRef?.target?.history?.nodes?.map((n) => n.additions) || [],
      note: 'WHOLE-COMMIT stats — must not be used as path-scoped churn',
    }
  }

  // ---- TEST C + D + E — blame: single files, file sizes, batching -------
  if (pubMain) {
    const { owner, name } = splitRepo(pubMain)
    const files = (trees[pubMain]?.filePaths || []).filter((f) => TEXT_EXT.test(f.path))
    // spread across size buckets using tree `size` (bytes, metadata only)
    const sorted = [...files].sort((a, b) => (a.size || 0) - (b.size || 0))
    const picks = [sorted[Math.floor(sorted.length * 0.05)], sorted[Math.floor(sorted.length * 0.5)], sorted[Math.floor(sorted.length * 0.95)]].filter(Boolean)
    results.tests.blameSingle = []
    for (const f of picks) {
      const r = await gql(blameQuery(), { owner, name, path: f.path }, 'blame.single')
      const ranges = r.data?.repository?.object?.blame?.ranges || []
      const sum = summarizeBlameRanges(ranges)
      results.tests.blameSingle.push({
        file: f.path, fileBytes: f.size, ok: r.ok, error: r.error,
        ...sum, cost: r.cost, remaining: r.remaining, ms: r.ms, respBytes: r.responseBytes,
      })
    }
    // alias batches 1,5,10,20,50 — only proceed while clean
    results.tests.blameBatch = []
    const batchPool = sorted.filter((f) => (f.size || 0) > 200 && (f.size || 0) < 60000).slice(0, 60).map((f) => f.path)
    for (const n of [1, 5, 10, 20, 50]) {
      if (batchPool.length < n) { results.tests.blameBatch.push({ aliases: n, skipped: 'not enough files' }); continue }
      const paths = batchPool.slice(0, n)
      const vars = { owner, name }
      paths.forEach((p, i) => (vars[`p${i}`] = p))
      const r = await gql(batchedBlameQuery(paths), vars, `blame.batch${n}`)
      const commit = r.data?.repository?.object || {}
      let totalRanges = 0, totalLines = 0, failed = 0
      for (let i = 0; i < n; i++) {
        const ranges = commit[`b${i}`]?.ranges
        if (!ranges) { failed++; continue }
        totalRanges += ranges.length
        for (const rg of ranges) totalLines += rg.endingLine - rg.startingLine + 1
      }
      results.tests.blameBatch.push({
        aliases: n, ok: r.ok && !failed, error: r.error || (failed ? `${failed}/${n} aliases failed` : null),
        cost: r.cost, costPerFile: r.cost != null ? r.cost / n : null,
        ms: r.ms, msPerFile: r.ms / n, respBytes: r.responseBytes, totalRanges, totalLines,
        remaining: r.remaining,
      })
      if (!r.ok) break // do not escalate past a failing batch size
    }
  }

  // ---- TEST F — large public repo truncation probe ----------------------
  // A well-known large public repo tests truncated tree handling. The
  // installation token can read public repos even when not installed there.
  try {
    results.tests.treeTruncationProbe = { repo: 'facebook/react', ...(await treeOf('facebook/react')) }
    delete results.tests.treeTruncationProbe.filePaths
  } catch (e) {
    results.tests.treeTruncationProbe = { repo: 'facebook/react', error: String(e?.message || e).slice(0, 160) }
  }

  // ---- TEST G — rename/move characterization ----------------------------
  // Candidate rename pairs discovered from local history of the test repos.
  const renamePairs = (process.env.SPIKE_RENAME_PAIRS || 'src/ledgerData.ts>src/fixtures/ledgerData.ts')
    .split(',')
    .map((s) => s.split('>'))
    .filter((p) => p.length === 2)
  results.tests.renames = []
  for (const [oldPath, newPath] of renamePairs) {
    const { owner, name } = splitRepo(pubMain)
    const oldH = await gql(historyPathQuery(), { owner, name, path: oldPath }, 'rename.old')
    const newH = await gql(historyPathQuery(), { owner, name, path: newPath }, 'rename.new')
    const bl = await gql(blameQuery(), { owner, name, path: newPath }, 'rename.blame')
    const oldNodes = oldH.data?.repository?.defaultBranchRef?.target?.history?.nodes || []
    const newNodes = newH.data?.repository?.defaultBranchRef?.target?.history?.nodes || []
    const oldOids = new Set(oldNodes.map((n) => n.oid))
    results.tests.renames.push({
      repo: pubMain, oldPath, newPath,
      oldPathCommits: oldNodes.length, newPathCommits: newNodes.length,
      sharedCommits: newNodes.filter((n) => oldOids.has(n.oid)).length,
      blameRanges: bl.data?.repository?.object?.blame?.ranges?.length ?? null,
      blameCommits: new Set((bl.data?.repository?.object?.blame?.ranges || []).map((r) => r.commit?.oid)).size,
    })
  }

  // ---- TEST I — unlinked contributor rate (all collected data) -----------
  {
    const histPages = Object.values(results.tests.history || {}).flatMap((t) => t.pages || [])
    const totalNodes = histPages.reduce((s, p) => s + (p.nodes || 0), 0)
    const unlinkedNodes = histPages.reduce((s, p) => s + (p.unlinkedAuthors || 0), 0)
    const blameRanges = [...(results.tests.blameSingle || []), ...(results.tests.renames || [])]
    const uRanges = blameRanges.reduce((s, b) => s + (b.unlinkedRanges || 0), 0)
    const tRanges = blameRanges.reduce((s, b) => s + (b.ranges || 0), 0)
    results.tests.unlinked = {
      historyNodes: totalNodes, unlinkedHistory: unlinkedNodes,
      unlinkedHistoryRate: totalNodes ? unlinkedNodes / totalNodes : null,
      blameRanges: tRanges, unlinkedBlameRanges: uRanges,
      unlinkedBlameRate: tRanges ? uRanges / tRanges : null,
    }
  }

  // ---- TEST J — rate-limit summary --------------------------------------
  results.tests.rateLimit = {
    requests: reqCount,
    pacingMs: PACE_MS,
    note: 'No secondary-rate-limit condition was intentionally induced.',
  }

  // ---- output ------------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = path.join(OUT_DIR, `run-${stamp}.json`)
  fs.writeFileSync(rawPath, JSON.stringify(results, null, 2))
  console.log(`\n=== SPIKE COMPLETE — ${reqCount} requests ===`)
  console.log(`raw results: ${rawPath} (gitignored, local only)`)
  console.log(JSON.stringify(results.tests, (k, v) => (k === 'data' ? undefined : v), 2).slice(0, 4000))
}

run().catch((e) => {
  console.error('SPIKE FAILED:', e)
  process.exit(1)
})
