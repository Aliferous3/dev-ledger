import { createClient } from '@supabase/supabase-js'
import { db as cfg } from './config.mjs'

export const supabase = cfg.url ? createClient(cfg.url, cfg.serviceKey || '') : null

export function withUser(q, userId) {
  return q.eq('user_id', userId)
}
