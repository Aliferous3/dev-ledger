import { createClient } from '@supabase/supabase-js'
import { db as cfg } from './config.mjs'

// `let` + a test-only setter: ESM live bindings mean every importer observes
// the swap, so behavioral tests can inject an in-memory PostgREST fake
// without touching env or network.
export let supabase = cfg.url ? createClient(cfg.url, cfg.serviceKey || '') : null

export function __setSupabaseForTests(client) {
  supabase = client
}

export function withUser(q, userId) {
  return q.eq('user_id', userId)
}
