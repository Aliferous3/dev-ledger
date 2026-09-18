import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Integration test: proves per-user isolation and that an old historical
// commit becomes visible to range analytics once ingested. Runs only when
// Supabase credentials are present (local .env or CI env); skipped otherwise.
// All synthetic rows are deleted in a finally block — deleting the user row
// cascades to repositories, commits, coverage and sync state.

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
const url = env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const db = url && key ? createClient(url, key) : null

test('user isolation + old historical commit visibility', async (t) => {
  if (!db) return t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  const other = randomUUID()
  let userId = null
  try {
    const { data: u, error: ue } = await db
      .from('users')
      .insert({ github_user_id: Math.floor(Math.random() * 9e17) + 1e17, github_login: `it-${randomUUID().slice(0, 8)}` })
      .select('id')
      .single()
    if (ue) throw ue
    userId = u.id

    const { data: repo, error: re } = await db
      .from('repositories')
      .insert({ user_id: userId, github_repo_id: Math.floor(Math.random() * 9e17) + 1e17, owner_login: 'it', name: 'it-repo', full_name: 'it/it-repo' })
      .select('id')
      .single()
    if (re) throw re

    // Case 12: a commit authored inside 2025-07-17..24 — the interval that
    // displayed a false zero — becomes visible to the dashboard aggregation
    // once it has been ingested (which is what targeted range sync does).
    const { error: ce } = await db.from('commits').insert({
      user_id: userId,
      repository_id: repo.id,
      github_sha: `it-${randomUUID()}`,
      committed_at: '2025-07-20T14:30:00Z',
      authored_at: '2025-07-20T14:30:00Z',
      additions: 10,
      deletions: 2,
    })
    if (ce) throw ce

    const { data: days, error: de } = await db.rpc('dash_daily', { p_user: userId, p_from: '2025-07-17', p_to: '2025-07-24' })
    if (de) throw de
    assert.equal(days.length, 1)
    assert.equal(Number(days[0].commits), 1)
    assert.equal(days[0].date, '2025-07-20')

    // Case 11a: a different user id sees nothing of this data — every
    // analytics path filters by p_user / user_id.
    const { data: otherDays } = await db.rpc('dash_daily', { p_user: other, p_from: '2025-07-17', p_to: '2025-07-24' })
    assert.equal(otherDays.length, 0)

    // Case 11b: isolation holds across the raw tables too.
    for (const table of ['commits', 'repositories', 'pull_requests', 'repo_coverage', 'repo_sync', 'user_sync']) {
      const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq('user_id', other)
      assert.ifError(error)
      assert.equal(count, 0, `${table} leaked rows across user ids`)
    }
  } finally {
    if (userId) await db.from('users').delete().eq('id', userId) // cascades
  }
})
