import os from 'node:os'
import path from 'node:path'

export const MODE = process.env.DEV_LEDGER_MODE || (process.env.VERCEL ? 'hosted' : 'local')
export const PORT = Number(process.env.PORT || 4317)
export const ROOT = process.env.DEV_PROJECTS_ROOT || path.join(os.homedir(), 'Desktop', 'Projects')
export const SNAPSHOT_BLOB = process.env.SNAPSHOT_BLOB || 'dev-ledger-snapshot.json'
export const SNAPSHOT_STALE_MS = Number(process.env.SNAPSHOT_STALE_MS || 24 * 60 * 60 * 1000)
