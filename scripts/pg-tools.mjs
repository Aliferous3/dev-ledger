// pg_dump / pg_restore resolution for backup + recovery tooling.
//
// pg_dump/restore must run at a major version >= the server's — pg_dump 16
// cannot dump a Postgres 17 server. Resolution order:
//   1. a PATH binary whose major matches the server
//   2. `docker run --rm postgres:<serverMajor>` — the official image carries
//      matching client tools, so CI never needs postgres-client packages
// Credentials always travel through PG* env vars (forwarded name-only into
// docker with `-e NAME`) — never argv, never logs.

import { spawnSync } from 'node:child_process'
import { isLocalHost } from './operator-env.mjs'

function binMajor(name) {
  const r = spawnSync(name, ['--version'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) return null
  const m = String(r.stdout).match(/(\d+)\.\d+/)
  return m ? Number(m[1]) : null
}

function dockerAvailable() {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

// Returns { argv, env, display } where argv is the full command to spawn.
// `tool` is 'pg_dump' | 'pg_restore'; serverMajor comes from
// SHOW server_version_num. env must already contain the PG* connection vars.
export function resolvePgTool(tool, serverMajor, env, { stdin = false } = {}) {
  const local = binMajor(tool)
  if (local != null && local >= serverMajor) {
    return { argv: [tool], env, via: 'local' }
  }
  // PATH binary missing or older than the server — prefer the matching
  // postgres:<major> image so CI never needs a postgres-client package.
  if (!dockerAvailable()) {
    throw new Error(
      `${tool} ${local ?? 'not found'} cannot serve a Postgres ${serverMajor} database — ` +
      `install PostgreSQL ${serverMajor} client tools or make Docker available`
    )
  }
  // Container path: rewrite loopback to the host gateway so the container
  // reaches a server bound to the host's localhost (works for a published
  // docker port, a local postgres install, or a remote host unchanged).
  // Dump bytes stream over stdout; restore bytes stream over stdin (-i) —
  // the container never needs host filesystem access.
  const cEnv = { ...env }
  if (isLocalHost(cEnv.PGHOST)) cEnv.PGHOST = 'host.docker.internal'
  const dockerArgs = [
    'run', '--rm', ...(stdin ? ['-i'] : []),
    '--add-host', 'host.docker.internal:host-gateway',
    // name-only -e forwards the value without putting it in argv
    ...Object.keys(cEnv).flatMap((k) => ['-e', k]),
    `postgres:${serverMajor}`, tool,
  ]
  return { argv: ['docker', ...dockerArgs], env: cEnv, via: 'docker' }
}

// Streams: pg_dump writes the archive to stdout (binaryOut captures it as a
// Buffer); pg_restore reads the archive from stdin (`input`). No file paths
// cross the container boundary and no credentials enter argv.
export function runPgTool(tool, serverMajor, env, extraArgs, { input = null, binaryOut = false } = {}) {
  const { argv, env: toolEnv } = resolvePgTool(tool, serverMajor, env, { stdin: input != null })
  const r = spawnSync(argv[0], [...argv.slice(1), ...extraArgs], {
    env: { ...process.env, ...toolEnv },
    input,
    encoding: binaryOut ? 'buffer' : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (r.error) throw new Error(`${tool} failed to start: ${r.error.message}`)
  if (r.status !== 0) {
    // stderr can echo the server name but never the password — still, trim.
    const tail = String(r.stderr || '').trim().split('\n').slice(-3).join(' | ')
    throw new Error(`${tool} exited ${r.status}: ${tail}`)
  }
  return r
}
