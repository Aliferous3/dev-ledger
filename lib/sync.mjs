import { supabase } from './db.mjs'
import { getInstallationOctokit, withBackoff, RateLimitError, GitHubAuthError } from './github.mjs'
import { isAttributedCommit } from './analytics.mjs'

// Staged, resumable GitHub ingestion.
//
// discover  — list repositories accessible to the user's app installations
// metadata  — languages, pushed_at, primary language per repository
// commits   — GitHub-attributed commits w/ stats via GraphQL history, paged
// pulls     — pull requests authored by the user via issue search
//
// Every phase persists cursors in repo_sync / user_sync so a run can stop at
// its time budget and resume on the next invocation.

const HISTORY_QUERY = `
query ($owner: String!, $name: String!, $author: ID!, $cursor: String, $since: GitTimestamp) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, after: $cursor, author: { id: $author }, since: $since) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              committedDate
              authoredDate
              additions
              deletions
              changedFiles
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

const LOCK_MS = 60_000

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

export async function runSync(userId, { budgetMs = 20000, force = false } = {}) {
  const started = Date.now()
  const expired = () => Date.now() - started > budgetMs
  const beat = () => setUserSync(userId, {})

  const [{ data: user }, { data: installs }, existing] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('github_installations').select('*').eq('user_id', userId),
    getUserSync(userId),
  ])
  if (!user) return { status: 'error', error: 'user not found' }

  if (!force && existing) {
    if (existing.status === 'syncing' && Date.now() - new Date(existing.updated_at).getTime() < LOCK_MS) {
      return existing // another run is in flight
    }
    if (existing.status === 'rate_limited' && existing.resume_at && new Date(existing.resume_at) > new Date()) {
      return existing
    }
    if (existing.status === 'complete' && existing.last_synced_at &&
        Date.now() - new Date(existing.last_synced_at).getTime() < 60_000) {
      return existing // fresh enough; avoid hammering GitHub
    }
  }

  if (!(installs || []).length) {
    await setUserSync(userId, { status: 'needs_install', phase: 'discover', progress: 0, error: null })
    return getUserSync(userId)
  }

  await setUserSync(userId, { status: 'syncing', phase: 'discover', started_at: new Date().toISOString(), error: null, resume_at: null })

  const octokits = new Map()
  let authFailed = false
  const octokitFor = async (installationId) => {
    if (!octokits.has(installationId)) octokits.set(installationId, await getInstallationOctokit(installationId))
    return octokits.get(installationId)
  }

  try {
    // ---- phase: discover -----------------------------------------------
    const seenRepoIds = new Set()
    const repoByGhId = new Map()
    for (const inst of installs) {
      let octokit
      try {
        octokit = await octokitFor(inst.installation_id)
      } catch {
        authFailed = true
        continue
      }
      let page = 1
      for (;;) {
        let data
        try {
          const res = await withBackoff(() =>
            octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100, page })
          )
          data = res.data
        } catch (err) {
          if (err?.status === 404) { authFailed = true; break } // installation deleted on GitHub
          throw err
        }
        for (const repo of data.repositories) {
          seenRepoIds.add(repo.id)
          const { data: row } = await supabase
            .from('repositories')
            .upsert({
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
            }, { onConflict: 'user_id,github_repo_id' })
            .select('id')
            .single()
          if (row) {
            repoByGhId.set(repo.id, row.id)
            await supabase
              .from('repo_sync')
              .upsert({ user_id: userId, repository_id: row.id, phase: 'pending' }, { onConflict: 'user_id,repository_id', ignoreDuplicates: true })
          }
        }
        if (data.repositories.length < 100 || expired()) break
        page++
      }
      if (expired()) break
    }

    if (authFailed && !seenRepoIds.size && !repoByGhId.size) {
      // Every installation is gone on GitHub's side — the app was uninstalled.
      await setUserSync(userId, { status: 'revoked', error: 'GitHub access was revoked' })
      return getUserSync(userId)
    }

    // Repositories the user de-authorized disappear from the account.
    if (seenRepoIds.size) {
      const { data: existingRepos } = await supabase.from('repositories').select('id, github_repo_id').eq('user_id', userId)
      const stale = (existingRepos || []).filter((r) => !seenRepoIds.has(r.github_repo_id)).map((r) => r.id)
      if (stale.length) await supabase.from('repositories').delete().in('id', stale)
    }

    const { data: allRepos } = await supabase.from('repositories').select('*').eq('user_id', userId)
    await setUserSync(userId, { repos_total: (allRepos || []).length })

    // ---- phase: metadata -----------------------------------------------
    await setUserSync(userId, { phase: 'metadata' })
    for (const repo of allRepos || []) {
      if (expired()) break
      const { data: rs } = await supabase
        .from('repo_sync').select('*').eq('user_id', userId).eq('repository_id', repo.id).single()
      if (!rs || rs.phase !== 'pending') continue
      try {
        const octokit = await octokitFor(repo.installation_id)
        const { data: langs } = await withBackoff(() =>
          octokit.rest.repos.listLanguages({ owner: repo.owner_login, repo: repo.name })
        )
        await supabase.from('repository_languages').delete().eq('repository_id', repo.id)
        const rows = Object.entries(langs).map(([language, bytes]) => ({ repository_id: repo.id, language, bytes }))
        if (rows.length) await supabase.from('repository_languages').insert(rows)
        await supabase.from('repo_sync')
          .update({ phase: 'commits', updated_at: new Date().toISOString() })
          .eq('id', rs.id)
      } catch (err) {
        await markRepoError(userId, repo.id, err)
        if (isFatal(err)) throw err
      }
    }

    // ---- phase: commits -------------------------------------------------
    await setUserSync(userId, { phase: 'commits' })
    const { data: commitQueue } = await supabase
      .from('repo_sync')
      .select('*, repositories!inner(id, owner_login, name, installation_id)')
      .eq('user_id', userId)
      .in('phase', ['commits', 'done']) // 'done' rows re-check incrementally via `since`
    for (const rs of commitQueue || []) {
      if (expired()) break
      const repo = rs.repositories
      try {
        await syncRepoCommits({ userId, user, rs, repo, octokitFor, expired })
        await beat()
      } catch (err) {
        await markRepoError(userId, repo.id, err)
        if (isFatal(err)) throw err
      }
    }

    // ---- phase: pulls ---------------------------------------------------
    if (!expired()) {
      await setUserSync(userId, { phase: 'pulls' })
      await syncPullRequests({ userId, user, installs, octokitFor })
    }

    const { count: doneCount } = await supabase
      .from('repo_sync').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('phase', 'done')
    const total = (allRepos || []).length || 1
    const done = doneCount ?? 0
    const finished = expired() ? 'syncing' : 'complete'
    await setUserSync(userId, {
      status: finished,
      phase: finished === 'complete' ? 'done' : 'commits',
      progress: Math.min(1, done / total),
      repos_done: done,
      ...(finished === 'complete' ? { completed_at: new Date().toISOString(), last_synced_at: new Date().toISOString() } : {}),
    })
    return getUserSync(userId)
  } catch (err) {
    if (err instanceof RateLimitError) {
      await setUserSync(userId, { status: 'rate_limited', resume_at: err.retryAt.toISOString(), error: 'GitHub rate limit reached — will resume automatically' })
    } else if (err instanceof GitHubAuthError) {
      await setUserSync(userId, { status: 'revoked', error: 'GitHub access was revoked' })
    } else {
      await setUserSync(userId, { status: 'error', error: String(err?.message || err).slice(0, 400) })
    }
    return getUserSync(userId)
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

async function syncRepoCommits({ userId, user, rs, repo, octokitFor, expired }) {
  const octokit = await octokitFor(repo.installation_id)
  const cursor = rs.cursor || {}
  // Incremental: after a full history pass, only look at commits since the
  // newest one we already stored (small overlap; upserts dedupe by SHA).
  const since = rs.phase === 'done' && rs.last_commit_at
    ? new Date(new Date(rs.last_commit_at).getTime() - 3600_000).toISOString()
    : cursor.since || null
  let after = rs.phase === 'done' ? null : cursor.endCursor || null

  let newest = rs.last_commit_at || null
  let hasMore = false
  for (;;) {
    const data = await withBackoff(() =>
      octokit.graphql(HISTORY_QUERY, {
        owner: repo.owner_login,
        name: repo.name,
        author: user.github_node_id,
        cursor: after,
        since,
      })
    )
    const history = data?.repository?.defaultBranchRef?.target?.history
    if (!history) { hasMore = false; break } // empty repo or non-commit ref
    const rows = []
    for (const node of history.nodes) {
      if (!isAttributedCommit(node, user.github_node_id)) continue
      rows.push({
        user_id: userId,
        repository_id: repo.id,
        github_sha: node.oid,
        author_user_id: user.github_user_id,
        author_login: node.author.user.login,
        authored_at: node.authoredDate,
        committed_at: node.committedDate,
        additions: node.additions || 0,
        deletions: node.deletions || 0,
        files_changed: node.changedFiles || 0,
        is_merge: (node.parents?.totalCount || 0) > 1,
        message: (node.messageHeadline || '').slice(0, 300),
      })
      if (!newest || node.committedDate > newest) newest = node.committedDate
    }
    if (rows.length) {
      await supabase.from('commits').upsert(rows, { onConflict: 'user_id,github_sha', ignoreDuplicates: true })
    }
    after = history.pageInfo.endCursor
    hasMore = history.pageInfo.hasNextPage
    if (!hasMore || expired()) break
  }
  await supabase.from('repo_sync')
    .update({
      phase: hasMore ? 'commits' : 'done',
      cursor: hasMore ? { endCursor: after, since } : null,
      last_commit_at: newest,
      last_synced_at: hasMore ? rs.last_synced_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rs.id)
}

async function syncPullRequests({ userId, user, installs, octokitFor }) {
  const lastSync = await getUserSync(userId)
  const sinceDate = lastSync?.last_synced_at ? lastSync.last_synced_at.slice(0, 10) : null
  let q = `type:pr author:${user.github_login}`
  if (sinceDate) q += ` updated:>=${sinceDate}`

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

  // An installation token's search is scoped to that installation's repos,
  // so iterate each installation.
  for (const inst of installs) {
    const octokit = await octokitFor(inst.installation_id)
    for (let page = 1; page <= 10; page++) { // GitHub search caps at 1000 results
      const { data } = await withBackoff(() =>
        octokit.rest.search.issuesAndPullRequests({ q, sort: 'updated', order: 'desc', per_page: 100, page })
      )
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
      }
      if (data.items.length < 100) break
    }
  }
}
