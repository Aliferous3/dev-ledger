import { MODE, ROOT } from './config.mjs'
import { collectLocal, githubStats, vercelStats } from './collectors.mjs'

export async function buildSnapshot(){
  const [local, github, vercel] = await Promise.allSettled([
    collectLocal(ROOT, null, null),
    githubStats(null, null),
    vercelStats(null, null)
  ])
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    mode: 'local',
    local: sanitizeLocal(local.status === 'fulfilled' ? local.value : { error: local.reason?.message }),
    github: sanitizeGithub(github.status === 'fulfilled' ? github.value : { connected: false, error: github.reason?.message }),
    vercel: sanitizeVercel(vercel.status === 'fulfilled' ? vercel.value : { connected: false, error: vercel.reason?.message })
  }
}

function sanitizeLocal(local){
  if (!local || local.error) return local
  const repos = (local.repositories || []).map(r => ({ ...r, path: r.name }))
  const { root, ...rest } = local
  return { ...rest, repositories: repos }
}

function sanitizeGithub(g){ return g }
function sanitizeVercel(v){ return v }

export function filterSnapshotByRange(local, from, to){
  if (!local) return { repositories: [], languages: [], daily: [], summary: {}, rhythm: [], tools: { git: false, cloc: false } }
  if (!from && !to) return local
  const inRange = d => (!from || d.date >= from) && (!to || d.date <= to)
  const daily = (local.daily || []).filter(inRange)
  const allDates = daily.map(d => d.date)
  const sum = k => daily.reduce((a, d) => a + (Number(d[k]) || 0), 0)
  const sourceAdded = sum('added')
  const sourceDeleted = sum('deleted')
  const peak = daily.reduce((a, b) => (!a || b.commits > a.commits) ? b : a, null)
  const summary = {
    ...local.summary,
    commits: sum('commits'),
    sourceAdded,
    sourceDeleted,
    allAdded: sourceAdded,
    allDeleted: sourceDeleted,
    allChurn: sourceAdded + sourceDeleted,
    activeDays: new Set(allDates).size,
    longestStreak: longestStreak(allDates),
    peakDayCommits: peak?.commits || 0,
    repos: (local.repositories || []).length
  }
  const repositories = (local.repositories || []).map(r => {
    const rDaily = (r.daily || []).filter(inRange)
    const rAdded = rDaily.reduce((a, d) => a + (Number(d.added) || 0), 0)
    const rDeleted = rDaily.reduce((a, d) => a + (Number(d.deleted) || 0), 0)
    const rCommits = rDaily.reduce((a, d) => a + (Number(d.commits) || 0), 0)
    const rDates = rDaily.map(d => d.date)
    const last = rDaily.length ? rDaily[rDaily.length - 1].date : null
    return { ...r, daily: rDaily, sourceAdded: rAdded, sourceDeleted: rDeleted, commits: rCommits, activeDays: new Set(rDates).size, lastCommit: last }
  }).sort((a, b) => (b.sourceAdded + b.sourceDeleted) - (a.sourceAdded + a.sourceDeleted))
  return { ...local, summary, daily, repositories }
}

function longestStreak(dates){
  const uniq = [...new Set(dates)].sort()
  let max = 0, cur = 0, prev = null
  for (const s of uniq) {
    const d = new Date(s + 'T00:00:00Z')
    if (prev && (d - prev) === 86400000) cur++
    else cur = 1
    max = Math.max(max, cur)
    prev = d
  }
  return max
}
