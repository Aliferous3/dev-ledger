import { supabase } from './db.mjs'
import { getInstallationOctokit, withBackoff, RateLimitError, GitHubAuthError } from './github.mjs'
import { isAttributedCommit } from './analytics.mjs'
import { coversRange, computeSyncProgress } from './coverage.mjs'

// Staged, resumable GitHub ingestion.
//
// discover  — list repositories accessible to the user's app installations
// metadata  — languages, pushed_at, primary language per repository
// commits   — GitHub-attributed commits w/ stats via GraphQL history, paged
// pulls     — pull requests authored by the user via issue search
//
// Every phase persists cursors in repo_sync / user_sync so a run can stop at
// its time budget and resume on the next invocation. Coverage windows are
// written to repo_coverage so the API can tell "no activity" apart from
// "history not yet synced".
//
// Commit stats (additions/deletions/changedFiles) ride inside the GraphQL
// history connection — there is deliberately no REST-per-commit pass, so
// "fast history" and "deep stats" arrive together at ~100 commits/request.

const HISTORY_QUERY = `
query ($owner: String!, $name: String!, $author: ID!, $cursor: String, $since: GitTimestamp, $until: GitTimestamp) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, after: $cursor, author: { id: $author }, since: $since, until: $until) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              committedDate
              authoredDate
              additions
              deletions
              changedFilesIfAvailable
              messageHeadline
              parents { totalCount }
              author { user { id login } }
            }
          }
        }
      }
    }
  }
}`

// One-commit probe used to learn whether any history exists before a bound.
const ROOT_PROBE_QUERY = `
query ($owner: String!, $name: String!, $until: GitTimestamp) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target { ... on Commit { history(first: 1, until: $until) { nodes { oid } } } }
    }
  }
}`

const LANG_QUERY_HEAD = 'query ('
// A live slice keeps locked_at fresh for at most ~45s (the slice budget);
// anything older means the owning invocation died and may be taken over.
const LOCK_STALE_MS = 90_000

// Atomic ownership claim. The conditional UPDATE only lands when the row is
// unlocked or holds an abandoned lock — concurrent kicks cannot both win.
// Returns true when this caller owns the slice.
export async function acquireSyncLock(userId) {
  const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString()
  // Ensure the row exists so the CAS has something to claim (no-op when the
  // callback already wrote its kick marker).
  await supabase.from('user_sync').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  const { data } = await supabase
    .from('user_sync')
    .update({ locked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .or(`locked_at.is.null,locked_at.lt.${stale}`)
    .select('user_id')
  return Boolean(data?.length)
}

// Minimal promise pool — bounded concurrency for independent per-repo work.
async function pmap(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const j = i++
        out[j] = await fn(items[j], j)
      }
    })
  )
  return out
}

export async function getUserSync(userId) {
  const { data } = await supabase
    .from('user_sync')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

export async function setUserSync(userId, patch) {
  await supabase
    .from('user_sync')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

// All stored coverage intervals for a user, grouped by repository id.
export async function getCoverage(userId) {
  const { data } = await supabase
    .from('repo_coverage')
    .select('repository_id, covered_from, covered_to, complete')
    .eq('user_id', userId)
  const byRepo = new Map()
  for (const row of data || []) {
    if (!byRepo.has(row.repository_id)) byRepo.set(row.repository_id, [])
    byRepo.get(row.repository_id).push({ from: row.covered_from, to: row.covered_to, complete: row.complete })
  }
  return byRepo
}

// Persist one freshly-scanned interval. When the interval reached the repo's
// first commit (complete) it collapses all earlier intervals into a single
// root-anchored row — complete coverage subsumes everything.
async function writeCoverage(userId, repositoryId, { from, to, complete }) {
  if (complete) {
    // A complete interval covers (-∞, to]: delete only rows it subsumes —
    // never drop coverage that extends beyond this interval.
    await supabase.from('repo_coverage').delete()
      .eq('user_id', userId).eq('repository_id', repositoryId)
      .lte('covered_to', to)
    await supabase.from('repo_coverage').insert({
      user_id: userId, repository_id: repositoryId, covered_from: from, covered_to: to, complete: true,
    })
  } else {
    await supabase.from('repo_coverage').upsert(
      { user_id: userId, repository_id: repositoryId, covered_from: from, covered_to: to, complete: false },
      { onConflict: 'user_id,repository_id,covered_from' }
    )
  }
}

// Push an existing coverage window forward to `to` (incremental sync). Falls
// back to writing the scanned fragment when no complete interval exists yet.
async function extendCoverage(userId, repositoryId, to, scannedFrom) {
  const { data } = await supabase
    .from('repo_coverage').select('id')
    .eq('user_id', userId).eq('repository_id', repositoryId).eq('complete', true)
    .limit(1)
  if (data?.length) {
    await supabase.from('repo_coverage')
      .update({ covered_to: to, updated_at: new Date().toISOString() })
      .eq('id', data[0].id)
  } else {
    await writeCoverage(userId, repositoryId, { from: scannedFrom, to, complete: false })
  }
}

export async function runSync(userId, { budgetMs = 20000, force = false, resume = false } = {}) {
  const started = Date.now()
  const expired = () => Date.now() - started > budgetMs
  const detail = {
    repos: { done: 0, total: 0 },
    history: { done: 0, active: 0, total: 0, commits: 0 },
    pulls: { done: false, count: 0 },
  }
  const progressOf = () =>
    computeSyncProgress({
      reposTotal: detail.repos.total,
      metaDone: detail.repos.done,
      historyDone: detail.history.done,
      historyActive: detail.history.active,
      pullsDone: detail.pulls.done,
    })
  // Status beats are telemetry only — never let them serialize ingestion.
  // Progress is clamped below 1: only the final status write may report
  // 100%, so the UI can never show "done" while a phase is still running.
  const beat = (patch = {}) =>
    setUserSync(userId, { detail, progress: Math.min(progressOf(), 0.99), ...patch }).catch(() => {})

  const [{ data: user }, { data: installs }, existing] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('github_installations').select('*').eq('user_id', userId),
    getUserSync(userId),
  ])
  if (!user) return { status: 'error', error: 'user not found' }

  if (!force && existing) {
    if (existing.status === 'rate_limited' && existing.resume_at && new Date(existing.resume_at) > new Date()) {
      return existing
    }
    if (existing.status === 'complete' && existing.last_synced_at &&
        Date.now() - new Date(existing.last_synced_at).getTime() < 60_000) {
      return existing // fresh enough; avoid hammering GitHub
    }
  }

  if (!(installs || []).length) {
    await setUserSync(userId, { status: 'needs_install', phase: 'discover', progress: 0, error: null, locked_at: null })
    return getUserSync(userId)
  }

  // Ownership claim. Every runner — pump POST, resume continuation, cron —
  // must win this CAS before doing work. Losers report the current state
  // without duplicating GitHub calls; a lock older than LOCK_STALE_MS is
  // abandoned and taken over, so a dead slice cannot wedge the account.
  if (!(await acquireSyncLock(userId))) {
    return { ...(existing || (await getUserSync(userId)) || { status: 'syncing' }), locked: true }
  }

  // Reset progress + detail with the status write: a previous run's stored
  // progress=1 / populated detail would otherwise render as "100% SYNC" and
  // full phase bars until the first beat recomputes them.
  await setUserSync(userId, { status: 'syncing', phase: 'discover', progress: 0, detail, started_at: new Date().toISOString(), error: null, resume_at: null })

  const octokits = new Map()
  let authFailed = false
  const octokitFor = async (installationId) => {
    if (!octokits.has(installationId)) octokits.set(installationId, await getInstallationOctokit(installationId))
    return octokits.get(installationId)
  }

  try {
    // ---- phase: discover — all installations in parallel, one upsert pass -
    const seenRepoIds = new Set()
    const repoRows = []
    await pmap(installs, 2, async (inst) => {
      let octokit
      try {
        octokit = await octokitFor(inst.installation_id)
      } catch {
        authFailed = true
        return
      }
      let page = 1
      for (;;) {
        let data
        try {
          const res = await withBackoff(() =>
            octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100, page })
          , { tag: 'rest.listInstallationRepos' })
          data = res.data
        } catch (err) {
          if (err?.status === 404) { authFailed = true; break } // installation deleted on GitHub
          throw err
        }
        for (const repo of data.repositories) {
          if (seenRepoIds.has(repo.id)) continue
          seenRepoIds.add(repo.id)
          repoRows.push({
            user_id: userId,
            github_repo_id: repo.id,
            installation_id: inst.installation_id,
            owner_login: repo.owner.login,
            name: repo.name,
            full_name: repo.full_name,
            private: repo.private,
            default_branch: repo.default_branch,
            primary_language: repo.language,
            archived: repo.archived,
            fork: repo.fork,
            pushed_at: repo.pushed_at,
          })
        }
        if (data.repositories.length < 100 || expired()) break
        page++
      }
    })

    const { data: upsertedRepos } = repoRows.length
      ? await supabase.from('repositories').upsert(repoRows, { onConflict: 'user_id,github_repo_id' }).select('id, github_repo_id')
      : { data: [] }
    const repoSyncRows = (upsertedRepos || []).map((r) => ({
      user_id: userId, repository_id: r.id, phase: 'pending',
    }))
    if (repoSyncRows.length) {
      await supabase.from('repo_sync')
        .upsert(repoSyncRows, { onConflict: 'user_id,repository_id', ignoreDuplicates: true })
    }

    if (authFailed && !seenRepoIds.size) {
      // Every installation is gone on GitHub's side — the app was uninstalled.
      await setUserSync(userId, { status: 'revoked', error: 'GitHub access was revoked', locked_at: null })
      return { ...(await getUserSync(userId)), ran: true }
    }

    // Repositories the user de-authorized disappear from the account.
    if (seenRepoIds.size) {
      const { data: existingRepos } = await supabase.from('repositories').select('id, github_repo_id').eq('user_id', userId)
      const stale = (existingRepos || []).filter((r) => !seenRepoIds.has(r.github_repo_id)).map((r) => r.id)
      if (stale.length) await supabase.from('repositories').delete().in('id', stale)
    }

    const { data: allRepos } = await supabase.from('repositories').select('*').eq('user_id', userId)
    detail.repos.total = (allRepos || []).length
    await beat({ repos_total: detail.repos.total })

    // ---- phases metadata + commits run CONCURRENTLY ---------------------
    // Languages and commit history are independent per repository, so a
    // small account gets both without paying for two serial phases. The
    // repo_sync rows move pending → commits → done as each repo clears its
    // metadata fetch; commit walks may start before languages land.
    await setUserSync(userId, { phase: 'commits' })

    const [{ data: pendingRows }, { data: commitQueue }] = await Promise.all([
      supabase.from('repo_sync').select('id, repository_id').eq('user_id', userId).eq('phase', 'pending'),
      supabase.from('repo_sync')
        .select('*, repositories!inner(id, owner_login, name, installation_id, pushed_at)')
        .eq('user_id', userId)
        .in('phase', ['pending', 'commits', 'done']), // pending too — history doesn't wait on languages
    ])
    const pendingIds = new Set((pendingRows || []).map((r) => r.repository_id))
    const rsIdByRepo = new Map((pendingRows || []).map((r) => [r.repository_id, r.id]))
    const pendingRepos = (allRepos || []).filter((r) => pendingIds.has(r.id))

    detail.history.total = (commitQueue || []).length
    detail.history.done = 0
    detail.history.active = 0
    await beat()

    const metadataTask = (async () => {
      const langRows = []
      const metaRsIds = []
      const metaRepoIds = []
      for (let i = 0; i < pendingRepos.length; i += 8) {
        if (expired()) break
        const chunk = pendingRepos.slice(i, i + 8)
        const langsByRepo = await fetchLanguagesChunked({ chunk, octokitFor })
        for (const repo of chunk) {
          const langs = langsByRepo.get(repo.id)
          if (langs === null) continue // fetch failed; leave pending for resume
          for (const [language, bytes] of Object.entries(langs)) {
            langRows.push({ repository_id: repo.id, language, bytes })
          }
          metaRsIds.push(rsIdByRepo.get(repo.id))
          metaRepoIds.push(repo.id)
        }
      }
      if (metaRsIds.length) {
        await Promise.all([
          supabase.from('repository_languages').delete().in('repository_id', metaRepoIds),
          supabase.from('repo_sync')
            .update({ phase: 'commits', updated_at: new Date().toISOString() })
            .in('id', metaRsIds)
            .eq('phase', 'pending'), // never regress a repo already done
        ])
        if (langRows.length) await supabase.from('repository_languages').insert(langRows)
      }
      detail.repos.done = detail.repos.total - (pendingRepos.length - metaRepoIds.length)
      await beat()
    })()

    const historyTask = pmap(commitQueue || [], 3, async (rs) => {
      if (expired()) return
      const repo = rs.repositories
      // Incremental skip: nothing pushed since our last completed scan of this
      // repo → no new commits can exist on the default branch.
      if (rs.phase === 'done' && rs.last_synced_at && repo.pushed_at && repo.pushed_at <= rs.last_synced_at) {
        // Verified unchanged — coverage still advances: we know nothing new
        // exists up to now.
        await extendCoverage(userId, repo.id, new Date().toISOString(), rs.last_synced_at)
        detail.history.done++
        return
      }
      detail.history.active++
      try {
        const { commits, finished } = await syncRepoCommits({ userId, user, rs, repo, octokitFor, expired })
        detail.history.commits += commits
        if (finished) detail.history.done++
      } catch (err) {
        await markRepoError(userId, repo.id, err)
        if (isFatal(err)) throw err
      } finally {
        detail.history.active--
        await beat()
      }
    })

    // ---- phase: pulls — one installation-scoped search, runs alongside ---
    const pullsTask = (async () => {
      if (expired()) return
      detail.pulls.count = await syncPullRequests({ userId, user, installs, octokitFor })
      detail.pulls.done = true
      await beat()
    })()

    await Promise.all([metadataTask, historyTask, pullsTask])

    if (!expired()) await setUserSync(userId, { phase: 'finalizing' })

    const { count: doneCount } = await supabase
      .from('repo_sync').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('phase', 'done')
    const total = (allRepos || []).length || 1
    const done = doneCount ?? 0
    const finished = expired() ? 'syncing' : 'complete'
    await setUserSync(userId, {
      status: finished,
      phase: finished === 'complete' ? 'done' : 'commits',
      progress: finished === 'complete' ? 1 : progressOf(),
      repos_done: done,
      detail,
      locked_at: null, // slice boundary — release ownership so the next kick continues immediately
      ...(finished === 'complete' ? { completed_at: new Date().toISOString(), last_synced_at: new Date().toISOString() } : {}),
    })
    return { ...(await getUserSync(userId)), ran: true }
  } catch (err) {
    const release = { locked_at: null }
    if (err instanceof RateLimitError) {
      await setUserSync(userId, { status: 'rate_limited', resume_at: err.retryAt.toISOString(), error: 'GitHub rate limit reached — will resume automatically', ...release })
    } else if (err instanceof GitHubAuthError) {
      await setUserSync(userId, { status: 'revoked', error: 'GitHub access was revoked', ...release })
    } else {
      await setUserSync(userId, { status: 'error', error: String(err?.message || err).slice(0, 400), ...release })
    }
    return { ...(await getUserSync(userId)), ran: true }
  }
}

// Targeted historical backfill for one [from, to] window across every repo
// that lacks coverage there. Used by "Sync this range" — never re-walks full
// history; it asks GitHub only for commits inside the window.
// from/to are 'YYYY-MM-DD' day strings (inclusive days, UTC).
export async function runRangeSync(userId, from, to, { budgetMs = 20000 } = {}) {
  const started = Date.now()
  const expired = () => Date.now() - started > budgetMs
  const fromIso = `${from}T00:00:00.000Z`
  const toIso = `${to}T23:59:59.999Z`

  const [{ data: user }, { data: installs }, { data: repos }, coverage] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('github_installations').select('*').eq('user_id', userId),
    supabase.from('repositories').select('*').eq('user_id', userId),
    getCoverage(userId),
  ])
  if (!user || !(installs || []).length) return { ok: false, error: 'no installation' }

  const prev = await getUserSync(userId)
  const prevStatus = prev?.status === 'complete' ? 'complete' : 'idle'
  await setUserSync(userId, {
    status: 'syncing', phase: 'range',
    detail: { ...(prev?.detail || {}), rangeSync: { from, to } },
  })

  const octokits = new Map()
  const octokitFor = async (installationId) => {
    if (!octokits.has(installationId)) octokits.set(installationId, await getInstallationOctokit(installationId))
    return octokits.get(installationId)
  }

  const missing = (repos || []).filter((r) => !coversRange(coverage.get(r.id) || [], fromIso, toIso))
  let scanned = 0
  try {
    await pmap(missing, 3, async (repo) => {
      if (expired()) return
      const octokit = await octokitFor(repo.installation_id)
      await syncRepoRange({ userId, user, repo, octokit, fromIso, toIso, expired })
      scanned++
    })
    // PRs authored inside the window (search is installation-scoped anyway)
    if (!expired()) {
      await pmap(installs, 2, async (inst) => {
        const octokit = await octokitFor(inst.installation_id)
        await syncPullRequests({ userId, user, installs: [inst], octokitFor: () => octokit, window: { from, to } })
      })
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      await setUserSync(userId, { status: 'rate_limited', resume_at: err.retryAt.toISOString(), error: 'GitHub rate limit reached — will resume automatically' })
      return { ok: false, error: 'rate_limited' }
    }
    if (err instanceof GitHubAuthError) {
      await setUserSync(userId, { status: 'revoked', error: 'GitHub access was revoked' })
      return { ok: false, error: 'revoked' }
    }
    // Non-fatal: fall through and report whatever coverage was achieved
  }

  const freshCoverage = await getCoverage(userId)
  const remaining = (repos || []).filter((r) => !coversRange(freshCoverage.get(r.id) || [], fromIso, toIso)).length
  const done = remaining === 0
  await setUserSync(userId, {
    status: done ? prevStatus : 'syncing',
    phase: done ? (prev?.phase === 'range' ? 'done' : prev?.phase || 'done') : 'range',
    detail: { ...(prev?.detail || {}), rangeSync: done ? null : { from, to } },
    ...(done && prev?.last_synced_at ? { last_synced_at: prev.last_synced_at } : {}),
  })
  return { ok: true, scanned, remaining, done }
}

// Detects commits the user authored during the window in repositories the
// installation cannot see (e.g. someone else's public repo). Explains the
// difference between "no activity" and "activity outside authorized repos".
export async function findOutsideCommits(userId, from, to) {
  const [{ data: installs }, { data: repos }, { data: user }] = await Promise.all([
    supabase.from('github_installations').select('*').eq('user_id', userId),
    supabase.from('repositories').select('full_name').eq('user_id', userId),
    supabase.from('users').select('github_login').eq('id', userId).single(),
  ])
  if (!user || !(installs || []).length) return 0
  const owned = new Set((repos || []).map((r) => r.full_name))
  const octokit = await getInstallationOctokit(installs[0].installation_id)
  const { data } = await withBackoff(() =>
    octokit.rest.search.commits({
      q: `author:${user.github_login} committer-date:${from}..${to}`,
      per_page: 100,
    })
  , { tag: 'rest.searchCommits' }).catch(() => ({ data: { items: [] } }))
  return (data.items || []).filter((c) => !owned.has(c.repository?.full_name)).length
}

// Languages for up to 8 repos in ONE GraphQL request (aliases per repo).
// Falls back to the REST endpoint per repo if the batched query fails.
async function fetchLanguagesChunked({ chunk, octokitFor }) {
  const result = new Map()
  const byInstallation = new Map()
  for (const repo of chunk) {
    if (!byInstallation.has(repo.installation_id)) byInstallation.set(repo.installation_id, [])
    byInstallation.get(repo.installation_id).push(repo)
  }
  for (const [installationId, repos] of byInstallation) {
    const octokit = await octokitFor(installationId)
    const vars = {}
    const fields = repos.map((r, i) => {
      vars[`o${i}`] = r.owner_login
      vars[`n${i}`] = r.name
      return `r${i}: repository(owner: $o${i}, name: $n${i}) { languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }`
    })
    const varDecls = repos.map((_, i) => `$o${i}: String!, $n${i}: String!`).join(', ')
    try {
      const data = await withBackoff(() =>
        octokit.graphql(`${LANG_QUERY_HEAD}${varDecls}) { ${fields.join(' ')} }`, vars)
      , { tag: 'graphql.languages' })
      repos.forEach((r, i) => {
        const edges = data?.[`r${i}`]?.languages?.edges
        if (!edges) { result.set(r.id, null); return }
        const langs = {}
        for (const e of edges) langs[e.node.name] = e.size
        result.set(r.id, langs)
      })
    } catch {
      // REST fallback per repo
      for (const r of repos) {
        try {
          const { data: langs } = await withBackoff(() =>
            octokit.rest.repos.listLanguages({ owner: r.owner_login, repo: r.name })
          , { tag: 'rest.listLanguages' })
          result.set(r.id, langs)
        } catch {
          result.set(r.id, null)
        }
      }
    }
  }
  return result
}

// Page walker for a repo's attributed commit history. The injected `fetch`
// keeps the pagination/coverage logic unit-testable without Octokit.
export async function walkHistory({ fetch, onPage, expired }) {
  let after = null
  let newest = null
  let oldest = null
  let total = 0
  let hasMore = false
  for (;;) {
    const history = await fetch(after)
    if (!history) { hasMore = false; break }
    const nodes = history.nodes || []
    if (nodes.length) {
      await onPage(nodes)
      total += nodes.length
      if (!newest || nodes[0].committedDate > newest) newest = nodes[0].committedDate
      const last = nodes[nodes.length - 1].committedDate
      if (!oldest || last < oldest) oldest = last
    }
    after = history.pageInfo?.endCursor || null
    hasMore = Boolean(history.pageInfo?.hasNextPage)
    if (!hasMore || expired()) break
  }
  return { hasMore, after, newest, oldest, total }
}

async function syncRepoCommits({ userId, user, rs, repo, octokitFor, expired }) {
  const octokit = await octokitFor(repo.installation_id)
  const cursor = rs.cursor || {}
  // Incremental: after a full history pass, only look at commits since the
  // newest one we already stored (small overlap; upserts dedupe by SHA).
  const since = rs.phase === 'done' && rs.last_commit_at
    ? new Date(new Date(rs.last_commit_at).getTime() - 3600_000).toISOString()
    : cursor.since || null
  const after0 = rs.phase === 'done' ? null : cursor.endCursor || null
  const scanStart = new Date().toISOString()

  let newest = rs.last_commit_at || null
  let commits = 0
  const walk = await walkHistory({
    expired,
    fetch: async (after) => {
      const data = await withBackoff(() =>
        octokit.graphql(HISTORY_QUERY, {
          owner: repo.owner_login,
          name: repo.name,
          author: user.github_node_id,
          cursor: after ?? after0,
          since,
        })
      , { tag: 'graphql.commitHistory' })
      return data?.repository?.defaultBranchRef?.target?.history || null
    },
    onPage: async (nodes) => {
      const rows = []
      for (const node of nodes) {
        if (!isAttributedCommit(node, user.github_node_id)) continue
        rows.push(commitRow(node, userId, repo.id, user))
      }
      if (rows.length) {
        await supabase.from('commits').upsert(rows, { onConflict: 'user_id,github_sha', ignoreDuplicates: true })
        commits += rows.length
      }
    },
  })
  if (walk.newest && (!newest || walk.newest > newest)) newest = walk.newest

  // Coverage: the walk scanned [walk.oldest, scanStart].
  if (walk.hasMore) {
    // Paused mid-walk: only the newest fragment is covered; the cursor
    // persists so the remainder resumes on the next run.
    if (walk.oldest) {
      await writeCoverage(userId, repo.id, { from: walk.oldest, to: scanStart, complete: false })
    }
  } else if (since) {
    // Incremental pass on an already-covered repo: extend the existing
    // coverage forward rather than collapsing history to this window.
    await extendCoverage(userId, repo.id, scanStart, since)
  } else {
    // Full walk reached the repo root → complete coverage anchored at the
    // oldest commit (epoch for repos with no attributed commits at all).
    await writeCoverage(userId, repo.id, {
      from: walk.oldest || '1970-01-01T00:00:00.000Z',
      to: scanStart,
      complete: true,
    })
  }

  await supabase.from('repo_sync')
    .update({
      phase: walk.hasMore ? 'commits' : 'done',
      cursor: walk.hasMore ? { endCursor: walk.after, since } : null,
      last_commit_at: newest,
      last_synced_at: walk.hasMore ? rs.last_synced_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rs.id)
  return { commits, finished: !walk.hasMore }
}

// Targeted window backfill for one repo: commits with committedDate inside
// [fromIso, toIso]. Detects whether the window touches the repo root so the
// coverage interval can be marked complete.
async function syncRepoRange({ userId, user, repo, octokit, fromIso, toIso, expired }) {
  const scanStart = new Date().toISOString()
  let commits = 0
  const walk = await walkHistory({
    expired,
    fetch: async (after) => {
      const data = await withBackoff(() =>
        octokit.graphql(HISTORY_QUERY, {
          owner: repo.owner_login,
          name: repo.name,
          author: user.github_node_id,
          cursor: after,
          since: fromIso,
          until: toIso,
        })
      , { tag: 'graphql.rangeHistory' })
      return data?.repository?.defaultBranchRef?.target?.history || null
    },
    onPage: async (nodes) => {
      const rows = nodes
        .filter((node) => isAttributedCommit(node, user.github_node_id))
        .map((node) => commitRow(node, userId, repo.id, user))
      if (rows.length) {
        await supabase.from('commits').upsert(rows, { onConflict: 'user_id,github_sha', ignoreDuplicates: true })
        commits += rows.length
      }
    },
  })

  // If the walk paused mid-window, only [oldest_seen, toIso] was actually
  // scanned — record that fragment so the missing tail can resume later.
  if (walk.hasMore) {
    if (walk.oldest) {
      await writeCoverage(userId, repo.id, { from: walk.oldest, to: toIso, complete: false })
    }
    return { commits }
  }

  // Whole window scanned. Does anything exist before it? If not, the
  // interval is root-anchored and can be marked complete.
  const probe = await withBackoff(() =>
    octokit.graphql(ROOT_PROBE_QUERY, { owner: repo.owner_login, name: repo.name, until: fromIso })
  , { tag: 'graphql.rootProbe' }).catch(() => null)
  const touchesRoot = !(probe?.repository?.defaultBranchRef?.target?.history?.nodes?.length)
  await writeCoverage(userId, repo.id, { from: fromIso, to: toIso > scanStart ? scanStart : toIso, complete: touchesRoot })
  return { commits }
}

function commitRow(node, userId, repoId, user) {
  return {
    user_id: userId,
    repository_id: repoId,
    github_sha: node.oid,
    author_user_id: user.github_user_id,
    author_login: node.author.user.login,
    authored_at: node.authoredDate,
    committed_at: node.committedDate,
    additions: node.additions || 0,
    deletions: node.deletions || 0,
    files_changed: node.changedFilesIfAvailable || 0,
    is_merge: (node.parents?.totalCount || 0) > 1,
    message: (node.messageHeadline || '').slice(0, 300),
  }
}

function isFatal(err) {
  return err instanceof RateLimitError || err instanceof GitHubAuthError
}

async function markRepoError(userId, repositoryId, err) {
  await supabase
    .from('repo_sync')
    .update({ phase: 'error', error: String(err?.message || err).slice(0, 300), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('repository_id', repositoryId)
}

async function syncPullRequests({ userId, user, installs, octokitFor, window = null }) {
  const lastSync = await getUserSync(userId)
  const sinceDate = lastSync?.last_synced_at ? lastSync.last_synced_at.slice(0, 10) : null
  let q = `type:pr author:${user.github_login}`
  if (window) q += ` created:${window.from}..${window.to}`
  else if (sinceDate) q += ` updated:>=${sinceDate}`

  const repoCache = new Map()
  const repoRowByFullName = async (fullName) => {
    if (!fullName) return null
    if (!repoCache.has(fullName)) {
      const { data } = await supabase
        .from('repositories').select('id').eq('user_id', userId).eq('full_name', fullName).maybeSingle()
      repoCache.set(fullName, data?.id || null)
    }
    return repoCache.get(fullName)
  }

  let count = 0
  // An installation token's search is scoped to that installation's repos,
  // so iterate each installation.
  await pmap(installs, 2, async (inst) => {
    const octokit = await octokitFor(inst.installation_id)
    for (let page = 1; page <= 10; page++) { // GitHub search caps at 1000 results
      const { data } = await withBackoff(() =>
        octokit.rest.search.issuesAndPullRequests({ q, sort: 'updated', order: 'desc', per_page: 100, page })
      , { tag: 'rest.searchIssuesPrs' })
      if (!data.items?.length) break
      const rows = []
      for (const item of data.items) {
        if (item.user?.id !== user.github_user_id) continue
        const fullName = (item.repository_url || '').split('/repos/')[1]
        rows.push({
          user_id: userId,
          repository_id: await repoRowByFullName(fullName),
          github_pr_id: item.id,
          number: item.number,
          author_user_id: item.user.id,
          author_login: item.user.login,
          state: item.pull_request?.merged_at ? 'merged' : item.state,
          created_at: item.created_at,
          closed_at: item.closed_at,
          merged_at: item.pull_request?.merged_at || null,
          title: (item.title || '').slice(0, 300),
        })
      }
      if (rows.length) {
        await supabase.from('pull_requests').upsert(rows, { onConflict: 'user_id,github_pr_id' })
        count += rows.length
      }
      if (data.items.length < 100) break
    }
  })
  return count
}
