// Production wiring for the ACCUMULATE engine (Phase 1C-B2).
//
// This module adapts the repo's real infrastructure — supabase-js and the
// installation Octokit — to the small transport/db surfaces the engine
// consumes. The pure engine lives in accumulate.mjs and stays free of
// infra imports so unit tests can drive it with in-memory doubles.
//
// Feature gate: runOwnershipAccumulate is the ONLY callable production
// entrypoint and it passes through the OWNERSHIP_INGEST_REPOS hard-off
// gate before ANY GitHub request or ownership write. Nothing schedules it
// — no cron, no webhook, no UI — so production ownership tables receive
// zero rows until a later phase deliberately enables the gate.

import { supabase } from '../db.mjs'
import { getInstallationOctokit, withBackoff } from '../github.mjs'
import { assertOwnershipIngestAllowed } from './gate.mjs'
import { runAccumulateSlice, SLICE_BUDGET_MS } from './accumulate.mjs'

// ── supabase adapter ──────────────────────────────────────────────────────
// Guarded sync-state writes use PostgREST equality predicates that mirror
// the B1 CAS: building_version and history_cursor are match predicates
// (null -> IS NULL, absent -> no predicate) so a racing update can never
// slip through.
export function makeSupabaseOwnershipDb(client) {
  return {
    async loadRepo(repositoryId) {
      const { data } = await client
        .from('repositories')
        .select('id, user_id, owner_login, name, installation_id')
        .eq('id', repositoryId)
        .maybeSingle()
      return data ?? null
    },
    async ensureSyncRow(userId, repositoryId) {
      const { error } = await client
        .from('ownership_sync_state')
        .upsert(
          { user_id: userId, repository_id: repositoryId, phase: 'pending' },
          { onConflict: 'user_id,repository_id', ignoreDuplicates: true },
        )
      if (error) throw error
    },
    async loadSync(userId, repositoryId) {
      const { data } = await client
        .from('ownership_sync_state')
        .select('*')
        .eq('user_id', userId)
        .eq('repository_id', repositoryId)
        .maybeSingle()
      return data ?? null
    },
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args)
      if (error) throw error
      return data
    },
    async upsertScopes(rows) {
      if (!rows.length) return []
      const { data, error } = await client
        .from('ownership_scopes')
        .upsert(rows, { onConflict: 'repository_id,scope_path_hash' })
        .select('id, scope_path_hash, depth')
      if (error) throw error
      return data ?? []
    },
    async insertMembership(rows) {
      if (!rows.length) return
      const { error } = await client
        .from('ownership_scope_versions')
        .upsert(rows, {
          onConflict: 'scope_id,calculation_version',
          ignoreDuplicates: true,
        })
      if (error) throw error
    },
    async membershipFor(userId, repositoryId, version) {
      const { data } = await client
        .from('ownership_scope_versions')
        .select('scope_id, excluded')
        .eq('user_id', userId)
        .eq('repository_id', repositoryId)
        .eq('calculation_version', version)
      return data ?? []
    },
    async loadScope(scopeId) {
      const { data } = await client
        .from('ownership_scopes')
        .select('id, display_path, scope_type')
        .eq('id', scopeId)
        .maybeSingle()
      return data ?? null
    },
    async casSync({ userId, repositoryId, match = {}, patch }) {
      let q = client
        .from('ownership_sync_state')
        .update(patch)
        .eq('user_id', userId)
        .eq('repository_id', repositoryId)
      if ('building_version' in match) {
        q = match.building_version == null
          ? q.is('building_version', null)
          : q.eq('building_version', match.building_version)
      }
      if ('history_cursor' in match) {
        q = match.history_cursor == null
          ? q.is('history_cursor', null)
          : q.eq('history_cursor', match.history_cursor)
      }
      const { data, error } = await q.select('user_id')
      if (error) throw error
      return (data?.length ?? 0) > 0
    },
  }
}

// ── octokit transport ─────────────────────────────────────────────────────
// GraphQL goes through withBackoff so secondary/transient errors get the
// same retry treatment as the activity pipeline; RateLimitError and
// GitHubAuthError propagate unchanged for the engine's closed taxonomy.
export function makeOctokitTransport(octokit) {
  return {
    graphql: (query, vars) =>
      withBackoff(() => octokit.graphql(query, vars), { tag: 'ownership.graphql' }),
    async getTree({ owner, repo, treeSha }) {
      const res = await withBackoff(
        () =>
          octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: treeSha,
            recursive: 'true',
          }),
        { tag: 'ownership.tree' },
      )
      const d = res?.data ?? {}
      return { tree: Array.isArray(d.tree) ? d.tree : [], truncated: d.truncated === true }
    },
  }
}

// ── gated production entrypoint ───────────────────────────────────────────
// Dormant until a later phase wires a caller. The hard-off gate throws
// before a repo row is even read — no GitHub request, no DB write, no
// feature state change when the gate is closed.
export async function runOwnershipAccumulate(repositoryId, { budgetMs = SLICE_BUDGET_MS, env } = {}) {
  assertOwnershipIngestAllowed(repositoryId, env)
  const db = makeSupabaseOwnershipDb(supabase)
  const repo = await db.loadRepo(repositoryId)
  if (!repo || !repo.installation_id) {
    return { status: 'error', code: 'OWNERSHIP_INTERNAL_ERROR' }
  }
  const octokit = await getInstallationOctokit(repo.installation_id)
  return runAccumulateSlice({
    db,
    transport: makeOctokitTransport(octokit),
    repositoryId,
    budgetMs,
    env,
  })
}
