// Direct-Postgres ownership db adapter for the ACCUMULATE engine.
//
// Used by the recovery-drill / proof harness to run the real engine against
// the real own_* functions — no PostgREST. jsonb columns receive
// sql.json()-encoded values; guarded updates use IS NULL / equality
// predicates identical to the supabase adapter's match semantics.

export function makePgOwnershipDb(sql) {
  return {
    async loadRepo(repositoryId) {
      const rows = await sql`
        select id, user_id, owner_login, name, installation_id
          from repositories where id = ${repositoryId}`
      return rows[0] ?? null
    },
    async ensureSyncRow(userId, repositoryId) {
      await sql`
        insert into ownership_sync_state (user_id, repository_id, phase)
        values (${userId}, ${repositoryId}, 'pending')
        on conflict (user_id, repository_id) do nothing`
    },
    async loadSync(userId, repositoryId) {
      const rows = await sql`
        select * from ownership_sync_state
         where user_id = ${userId} and repository_id = ${repositoryId}`
      return rows[0] ?? null
    },
    async rpc(fn, args) {
      const keys = Object.keys(args)
      const params = keys.map((k) => args[k])
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(',')
      const rows = await sql.unsafe(`select ${fn}(${placeholders}) as r`, params)
      return rows[0]?.r
    },
    async upsertScopes(rows) {
      if (!rows.length) return []
      return sql`
        insert into ownership_scopes ${sql(rows)}
        on conflict (repository_id, scope_path_hash)
        do update set depth = excluded.depth
        returning id, scope_path_hash, depth`
    },
    async insertMembership(rows) {
      if (!rows.length) return
      await sql`
        insert into ownership_scope_versions ${sql(rows)}
        on conflict (scope_id, calculation_version) do nothing`
    },
    async membershipFor(userId, repositoryId, version) {
      return sql`
        select scope_id, excluded from ownership_scope_versions
         where user_id = ${userId} and repository_id = ${repositoryId}
           and calculation_version = ${version}`
    },
    async loadScope(scopeId) {
      const rows = await sql`
        select id, display_path, scope_type from ownership_scopes where id = ${scopeId}`
      return rows[0] ?? null
    },
    async casSync({ userId, repositoryId, match = {}, patch }) {
      // jsonb-typed values go through sql.json so the driver encodes them
      // structurally; scalar columns pass through as plain params
      const sets = Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [
          k,
          v !== null && typeof v === 'object' ? sql.json(v) : v,
        ]),
      )
      const conds = []
      if ('building_version' in match) {
        conds.push(
          match.building_version == null
            ? sql`building_version is null`
            : sql`building_version = ${match.building_version}`,
        )
      }
      if ('history_cursor' in match) {
        conds.push(
          match.history_cursor == null
            ? sql`history_cursor is null`
            : sql`history_cursor = ${sql.json(match.history_cursor)}`,
        )
      }
      if (!conds.length) throw new Error('casSync requires a match predicate')
      const where = conds.reduce((a, c) => sql`${a} and ${c}`)
      const rows = await sql`
        update ownership_sync_state set ${sql(sets)}
         where user_id = ${userId} and repository_id = ${repositoryId} and ${where}
        returning user_id`
      return rows.length > 0
    },
  }
}
