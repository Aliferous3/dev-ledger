import { requireUser } from '../lib/require-user.mjs'
import { supabase } from '../lib/db.mjs'
import { parseRange } from '../lib/range.mjs'
import { summarizeDaily, dayKey } from '../lib/analytics.mjs'
import { getUserSync, getCoverage } from '../lib/sync.mjs'
import { rangeCoverageStatus } from '../lib/coverage.mjs'

// Single read endpoint for the dashboard. All data comes from our stored,
// normalized GitHub-ingested rows — never live GitHub calls — and every
// query is scoped by the internal user id from the authenticated session.
export default async function handler(req, res) {
  const userId = await requireUser(req, res)
  if (!userId) return

  let from, to
  try {
    ;({ from, to } = parseRange(req.query || {}))
  } catch (e) {
    res.status(400).json({ error: e.message })
    return
  }

  const [{ data: repos }, { data: daily }, { data: repoStats }, { data: rhythm }, { data: prs }, sync, coverage] =
    await Promise.all([
      supabase.from('repositories').select('*').eq('user_id', userId).order('pushed_at', { ascending: false }).limit(1000),
      supabase.rpc('dash_daily', { p_user: userId, p_from: from, p_to: to }),
      supabase.rpc('dash_repos', { p_user: userId, p_from: from, p_to: to }),
      supabase.rpc('dash_rhythm', { p_user: userId, p_from: from, p_to: to }),
      supabase.from('pull_requests').select('state, created_at, merged_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(3000),
      getUserSync(userId),
      getCoverage(userId),
    ])

  const repoIds = (repos || []).map((r) => r.id)
  const { data: langRows } = repoIds.length
    ? await supabase.from('repository_languages').select('repository_id, language, bytes').in('repository_id', repoIds)
    : { data: [] }

  const statsByRepo = new Map((repoStats || []).map((s) => [s.repository_id, s]))
  const langByRepo = new Map()
  const langTotals = new Map()
  for (const l of langRows || []) {
    langByRepo.set(l.repository_id, (langByRepo.get(l.repository_id) || 0) + Number(l.bytes || 0))
    langTotals.set(l.language, (langTotals.get(l.language) || 0) + Number(l.bytes || 0))
  }

  const s = summarizeDaily(daily || [])
  const inRange = (iso) => {
    const d = dayKey(iso)
    return (!from || d >= from) && (!to || d <= to)
  }

  const prsInRange = (prs || []).filter((p) => inRange(p.created_at))
  const mergedInRange = (prs || []).filter((p) => p.merged_at && inRange(p.merged_at))

  const prsDailyMap = new Map()
  for (const p of prsInRange) {
    const k = dayKey(p.created_at)
    const row = prsDailyMap.get(k) || { date: k, opened: 0, merged: 0 }
    row.opened++
    prsDailyMap.set(k, row)
  }
  for (const p of mergedInRange) {
    const k = dayKey(p.merged_at)
    const row = prsDailyMap.get(k) || { date: k, opened: 0, merged: 0 }
    row.merged++
    prsDailyMap.set(k, row)
  }

  const repositories = (repos || []).map((r) => {
    const st = statsByRepo.get(r.id)
    return {
      name: r.name,
      path: r.full_name,
      private: r.private,
      fork: r.fork,
      archived: r.archived,
      primaryLanguage: r.primary_language || '',
      languageBytes: langByRepo.get(r.id) || 0,
      commits: Number(st?.commits || 0),
      sourceAdded: Number(st?.additions || 0),
      sourceDeleted: Number(st?.deletions || 0),
      activeDays: Number(st?.active_days || 0),
      lastCommitAt: st?.last_commit_at || null,
      lastCommit: st?.last_commit_at ? dayKey(st.last_commit_at) : (r.pushed_at ? dayKey(r.pushed_at) : null),
      lastActivityAt: r.pushed_at || null,
    }
  })

  const dailyRows = (daily || []).map((d) => ({
    date: dayKey(d.date),
    commits: Number(d.commits) || 0,
    added: Number(d.additions) || 0,
    deleted: Number(d.deletions) || 0,
  }))

  // Coverage of the requested range across all repositories — distinguishes
  // "no activity" from "history not synced".
  const perRepoCoverage = (repos || []).map((r) => coverage.get(r.id) || [])
  const rangeSync = sync?.detail?.rangeSync || null
  const syncingThisRange =
    sync?.status === 'syncing' &&
    (!rangeSync ||
      (!(rangeSync.to && rangeSync.to < (from || '')) && !(rangeSync.from && rangeSync.from > (to || '9999'))))
  const rangeCoverage = rangeCoverageStatus(perRepoCoverage, { from, to }, syncingThisRange)

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    range: { from, to },
    summary: {
      repos: repositories.length,
      commits: s.commits,
      sourceAdded: s.added,
      sourceDeleted: s.deleted,
      allAdded: s.added,
      allDeleted: s.deleted,
      allChurn: s.churn,
      activeDays: s.activeDays,
      longestStreak: s.longestStreak,
      peakDayCommits: s.peakDayCommits,
      languageBytes: [...langTotals.values()].reduce((a, b) => a + b, 0),
    },
    github: {
      connected: true,
      pullRequests: prsInRange.length,
      mergedPrs: mergedInRange.length,
      revoked: sync?.status === 'revoked',
    },
    sync: sync
      ? {
          status: sync.status,
          phase: sync.phase,
          progress: sync.progress,
          detail: sync.detail || null,
          lastSyncedAt: sync.last_synced_at,
          error: sync.error,
        }
      : { status: 'idle', progress: 0 },
    rangeCoverage,
    repositories,
    languages: [...langTotals.entries()].map(([language, code]) => ({ language, code, files: 0 })).sort((a, b) => b.code - a.code),
    daily: dailyRows,
    prsDaily: [...prsDailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    rhythm: (rhythm || []).map((r) => ({ weekday: r.weekday, hour: r.hour, commits: Number(r.commits) || 0, days: 0 })),
  })
}
