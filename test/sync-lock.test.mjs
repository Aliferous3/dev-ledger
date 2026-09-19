import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Integration test for the delete→reconnect cold-bootstrap fix:
//   - the per-user sync lock is a real CAS — concurrent kicks cannot both win
//   - a 'syncing' kick marker (OAuth callback) does NOT block the first slice
//   - an abandoned lock (stale locked_at) can be taken over
//   - deleting the users row cascades to every derived table
// Runs only when Supabase credentials are present; skipped otherwise.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
function loadEnv() {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...loadEnv(), ...process.env }
// Seed process.env so lib/db.mjs constructs a real client on first import.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
  if (!process.env[k] && env[k]) process.env[k] = env[k]
}
const db = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  : null

const makeUser = async () => {
  const { data, error } = await db
    .from('users')
    .insert({ github_user_id: Math.floor(Math.random() * 9e17) + 1e17, github_login: `it-${randomUUID().slice(0, 8)}` })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

test('sync lock CAS: single owner, marker non-blocking, stale takeover', async (t) => {
  if (!db) return t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  const { acquireSyncLock } = await import('../lib/sync.mjs')
  const userId = await makeUser()
  try {
    // The OAuth callback's kick marker: syncing + fresh updated_at, no lock.
    // Under the old updated_at heuristic this BLOCKED the first slice for
    // ~60s. With locked_at the first kick must proceed immediately.
    await db.from('user_sync').upsert({ user_id: userId, status: 'syncing', phase: 'discover' }, { onConflict: 'user_id' })
    assert.equal(await acquireSyncLock(userId), true, 'kick marker must not block first slice')

    // Second concurrent kick while a live slice holds the lock → loses.
    assert.equal(await acquireSyncLock(userId), false, 'live lock must reject duplicate slices')

    // Truly concurrent acquisition — exactly one winner.
    await db.from('user_sync').update({ locked_at: null }).eq('user_id', userId)
    const [a, b, c] = await Promise.all([acquireSyncLock(userId), acquireSyncLock(userId), acquireSyncLock(userId)])
    assert.equal([a, b, c].filter(Boolean).length, 1, 'exactly one concurrent kick may own the slice')

    // Stale lock (dead slice) → takeover succeeds.
    await db.from('user_sync')
      .update({ locked_at: new Date(Date.now() - 120_000).toISOString() })
      .eq('user_id', userId)
    assert.equal(await acquireSyncLock(userId), true, 'abandoned lock must be recoverable')

    // Released lock → next kick proceeds.
    await db.from('user_sync').update({ locked_at: null }).eq('user_id', userId)
    assert.equal(await acquireSyncLock(userId), true, 'released lock must allow the next slice')
  } finally {
    await db.from('users').delete().eq('id', userId)
  }
})

test('delete my data cascades every user-derived table', async (t) => {
  if (!db) return t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  const userId = await makeUser()
  const { data: repo } = await db.from('repositories')
    .insert({ user_id: userId, github_repo_id: Math.floor(Math.random() * 9e8), owner_login: 'it', name: 'r', full_name: 'it/r' })
    .select('id').single()
  await db.from('github_installations').insert({ user_id: userId, installation_id: Math.floor(Math.random() * 9e8) })
  await db.from('repository_languages').insert({ repository_id: repo.id, language: 'TS', bytes: 10 })
  await db.from('commits').insert({ user_id: userId, repository_id: repo.id, github_sha: randomUUID().replaceAll('-', '').slice(0, 40), committed_at: new Date().toISOString() })
  await db.from('pull_requests').insert({ user_id: userId, repository_id: repo.id, github_pr_id: Math.floor(Math.random() * 9e8), number: 1, created_at: new Date().toISOString() })
  await db.from('repo_sync').insert({ user_id: userId, repository_id: repo.id })
  await db.from('user_sync').insert({ user_id: userId, status: 'complete' })
  await db.from('repo_coverage').insert({ user_id: userId, repository_id: repo.id, covered_from: '2020-01-01', covered_to: '2021-01-01', complete: true })

  // The same statement DELETE /api/user issues.
  await db.from('users').delete().eq('id', userId)

  const leftovers = {}
  for (const [table, col, val] of [
    ['github_installations', 'user_id', userId],
    ['repositories', 'user_id', userId],
    ['commits', 'user_id', userId],
    ['pull_requests', 'user_id', userId],
    ['repo_sync', 'user_id', userId],
    ['user_sync', 'user_id', userId],
    ['repo_coverage', 'user_id', userId],
    ['repository_languages', 'repository_id', repo.id],
  ]) {
    const { count } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
    leftovers[table] = count
  }
  assert.deepEqual(leftovers, {
    github_installations: 0, repositories: 0, commits: 0, pull_requests: 0,
    repo_sync: 0, user_sync: 0, repo_coverage: 0, repository_languages: 0,
  }, 'delete must leave no user-derived rows')
})
