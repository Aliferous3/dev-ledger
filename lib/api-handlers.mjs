import { MODE, ROOT, SNAPSHOT_STALE_MS } from './config.mjs'
import { parseRange } from './range.mjs'
import { collectLocal, githubStats, vercelStats } from './collectors.mjs'
import { buildSnapshot, filterSnapshotByRange } from './snapshot.mjs'
import { readSnapshot } from './storage.mjs'

function send(res, status, body){
  res.statusCode = status
  res.setHeader('Content-Type','application/json')
  res.end(JSON.stringify(body))
}

function inRange(date, from, to){
  if (!date) return false
  const d = date.slice(0,10)
  return (!from || d >= from) && (!to || d <= to)
}

function snapshotFresh(snapshot){
  const at = snapshot?.generatedAt
  if (!at) return false
  return Date.now() - new Date(at).getTime() < SNAPSHOT_STALE_MS
}

export async function handleHealth(req, res){
  if (MODE === 'hosted') {
    let snapshot = null, snapshotUpdatedAt = null, localSnapshot = false, age = null
    try {
      snapshot = await readSnapshot()
      snapshotUpdatedAt = snapshot?.generatedAt
      localSnapshot = !!snapshot?.local
      age = snapshotUpdatedAt ? Date.now() - new Date(snapshotUpdatedAt).getTime() : null
    } catch {}
    send(res, 200, { ok: true, mode: 'hosted', snapshotUpdatedAt, snapshotAgeMs: age, sources: { localSnapshot, github: true, vercel: true } })
  } else {
    send(res, 200, { ok: true, mode: 'local', sources: { localSnapshot: true, github: true, vercel: true } })
  }
}

export async function handleLocal(req, res){
  try {
    const q = req.query || {}
    const { from, to } = parseRange(q)
    if (MODE === 'hosted') {
      const snapshot = await readSnapshot()
      const data = filterSnapshotByRange(snapshot?.local, from, to)
      data.generatedAt = snapshot?.generatedAt
      data.snapshotFresh = snapshotFresh(snapshot)
      send(res, 200, data)
    } else {
      const data = await collectLocal(ROOT, from, to)
      send(res, 200, data)
    }
  } catch (e) {
    send(res, 400, { error: e.message })
  }
}

export async function handleGithub(req, res){
  try {
    const { from, to } = parseRange(req.query || {})
    if (MODE === 'hosted') {
      const snapshot = await readSnapshot()
      const data = snapshot?.github || { connected: false }
      send(res, 200, data)
    } else {
      const data = await githubStats(from, to)
      send(res, 200, data)
    }
  } catch (e) {
    send(res, 400, { connected: false, error: e.message })
  }
}

export async function handleVercel(req, res){
  try {
    const { from, to } = parseRange(req.query || {})
    if (MODE === 'hosted') {
      const snapshot = await readSnapshot()
      const data = snapshot?.vercel || { connected: false }
      if (data.deploymentList && (from || to)) {
        data.deploymentList = data.deploymentList.filter(d => inRange(d.createdAt, from, to))
      }
      send(res, 200, data)
    } else {
      const data = await vercelStats(from, to)
      send(res, 200, data)
    }
  } catch (e) {
    send(res, 400, { connected: false, error: e.message })
  }
}
