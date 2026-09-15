import { getSession } from '../lib/auth.mjs'
import { supabase } from '../lib/db.mjs'
import { parseRange } from '../lib/range.mjs'

export default async function handler(req, res) {
  const session = await getSession(req, res)
  if (!session?.userId || !supabase) {
    res.status(401).json({ error: 'Unauthenticated or database unavailable' })
    return
  }
  const { from, to } = parseRange(req.query || {})

  const [{ data: repos }, { data: daily }, { data: languages }] = await Promise.all([
    supabase.from('repositories').select('*').eq('user_id', session.userId).limit(1000),
    supabase.from('daily_activity').select('*').eq('user_id', session.userId).limit(3650),
    supabase.from('repository_languages').select('language, bytes'),
  ])

  const allRepos = (repos || []).filter((r) => inRange(r.last_synced_at, from, to))
  const allDaily = (daily || []).filter((d) => inRange(d.date, from, to))
  const allLangs = languages || []

  const langTotals = allLangs.reduce((m, l) => {
    const row = m.get(l.language) || { language: l.language, code: 0, files: 0 }
    row.code += Number(l.bytes) || 0
    m.set(l.language, row)
    return m
  }, new Map())

  const dailyMap = allDaily.reduce((m, d) => {
    const row = m.get(d.date) || { date: d.date, commits: 0, added: 0, deleted: 0, changed: 0 }
    row.commits += d.commits || 0
    row.added += d.additions || 0
    row.deleted += d.deletions || 0
    row.changed += (d.additions || 0) + (d.deletions || 0)
    m.set(d.date, row)
    return m
  }, new Map())

  const summary = {
    repos: allRepos.length,
    currentLoc: null,
    commits: allDaily.reduce((a, d) => a + (d.commits || 0), 0),
    sourceAdded: allDaily.reduce((a, d) => a + (d.additions || 0), 0),
    sourceDeleted: allDaily.reduce((a, d) => a + (d.deletions || 0), 0),
    allAdded: 0,
    allDeleted: 0,
    allChurn: 0,
    activeDays: new Set(allDaily.map((d) => d.date)).size,
    longestStreak: 0,
    peakDayCommits: 0,
  }
  summary.allAdded = summary.sourceAdded
  summary.allDeleted = summary.sourceDeleted
  summary.allChurn = summary.sourceAdded + summary.sourceDeleted

  const dailyRows = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const peak = dailyRows.reduce((a, b) => (!a || b.commits > a.commits ? b : a), null)
  summary.peakDayCommits = peak?.commits || 0

  const repositoryRows = allRepos.map((r) => ({
    name: r.name,
    path: r.full_name,
    currentLoc: null,
    primaryLanguage: r.primary_language || '',
    commits: 0,
    sourceAdded: 0,
    sourceDeleted: 0,
    activeDays: 0,
    lastCommit: r.last_synced_at ? r.last_synced_at.slice(0, 10) : null,
    lastCommitAt: r.last_synced_at,
  }))

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    range: { from, to },
    tools: { git: true, cloc: false },
    summary,
    repositories: repositoryRows,
    languages: [...langTotals.values()].sort((a, b) => b.code - a.code),
    daily: dailyRows,
    rhythm: [],
  })
}

function inRange(value, from, to) {
  if (!value) return false
  const d = String(value).slice(0, 10)
  return (!from || d >= from) && (!to || d <= to)
}
