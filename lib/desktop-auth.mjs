import crypto from 'node:crypto'
import { supabase } from './db.mjs'
import { isSessionLive } from './sessions.mjs'

// Desktop authentication handoff (see migrations/014_desktop_auth.sql and
// docs/desktop.md). The desktop app runs the EXISTING GitHub OAuth flow in
// the system browser, then receives the session through a dev-ledger://
// deep link carrying a single-use code, which it exchanges for an opaque
// bearer token. Design rules mirroring the web session model:
//
//   * codes and tokens are high-entropy random — never sealed payloads;
//   * only SHA-256 hashes are stored, so a database read yields nothing
//     replayable;
//   * a token is bound to a server-side auth_sessions row created for the
//     desktop client — logout, DELETE MY DATA and kill-all revoke it
//     through the same machinery as browser sessions;
//   * the browser session that produced the handoff stays independent —
//     signing out on the web does not sign out the desktop app, and vice
//     versa.

const CODES_TABLE = 'desktop_auth_codes'
const TOKENS_TABLE = 'desktop_tokens'

// Custom URI scheme registered by the desktop installers (NSIS registry
// keys, Info.plist CFBundleURLTypes, .desktop MimeType). Single scheme —
// no wildcards — matching the tauri.conf.json deep-link registration.
export const DESKTOP_SCHEME = 'dev-ledger'

// Handoff codes die fast — the deep link is delivered immediately; any
// delay means a lost launch, not a slow network.
export const CODE_TTL_MS = 2 * 60 * 1000
// Tokens carry their own hard ceiling in addition to the session row's.
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

const FLOW_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^dlc_[A-Za-z0-9_-]{32,64}$/
const TOKEN_RE = /^dlt_[A-Za-z0-9_-]{32,64}$/
const CHALLENGE_RE = /^[0-9a-f]{64}$/i
const VERIFIER_RE = /^[A-Za-z0-9_-]{32,64}$/

export function isDesktopFlowId(value) {
  return typeof value === 'string' && FLOW_RE.test(value)
}

// The PKCE-style challenge the app sends alongside desktop_flow:
// sha256(verifier) as lowercase hex. Only honored as a pair — a flow id
// without a matching challenge is ignored entirely.
export function isDesktopChallenge(value) {
  return typeof value === 'string' && CHALLENGE_RE.test(value)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function newSecret(prefix, bytes) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`
}

// For the ordinary GitHub OAuth callback, derive the short-lived desktop
// handoff code deterministically. Two requests carrying the SAME single-use
// GitHub authorization code must be able to redirect to the SAME handoff.
// HMAC keeps the browser-visible GitHub code and the DB-stored SHA-256 hash
// insufficient to reconstruct the desktop handoff credential. GitHub App
// installation setup hops (no OAuth authorization code) remain randomized.
export function oauthDesktopHandoffCode(oauthCode, flow, challenge) {
  const key = process.env.SESSION_SECRET
  if (typeof key !== 'string' || key.length < 32
    || typeof oauthCode !== 'string' || !oauthCode || oauthCode.length > 512
    || !isDesktopFlowId(flow) || !isDesktopChallenge(challenge)) return null
  const mac = crypto.createHmac('sha256', key)
    .update('dev-ledger/desktop-handoff/oauth-v1\0')
    .update(oauthCode)
    .update('\0')
    .update(flow.toLowerCase())
    .update('\0')
    .update(challenge.toLowerCase())
    .digest('base64url')
  return `dlc_${mac}`
}

// The deep link delivered to the desktop app. Only the single-use code
// travels — never a session id, never a token.
export function desktopDeepLink(flow, code) {
  const u = new URL(`${DESKTOP_SCHEME}://auth`)
  u.searchParams.set('flow', flow)
  u.searchParams.set('code', code)
  return u.toString()
}

// If this request's sealed session is completing a desktop login
// (session.desktopFlow set by /api/auth/login?desktop_flow=<uuid>), emit
// a one-time code and redirect to the deep link instead of a web page.
// Returns true when the handoff response was sent. Anything missing —
// no flow, no session id, no database — falls back to the normal web
// redirect so the browser flow is never broken by desktop plumbing.
export async function desktopHandoff(res, session, webLocation, oauthCode = null) {
  const flow = session?.desktopFlow
  if (!flow || !session?.userId || !session?.sid || !supabase) return false
  const challenge = session.desktopChallenge
  delete session.desktopFlow
  delete session.desktopChallenge
  const code = oauthCode
    ? oauthDesktopHandoffCode(oauthCode, flow, challenge)
    : newSecret('dlc', 24)
  // Never emit an unprotected handoff when the HMAC configuration is absent.
  if (!code) {
    await session.save()
    res.writeHead(302, { Location: webLocation })
    res.end()
    return true
  }
  const { error } = await supabase.from(CODES_TABLE).insert({
    code_hash: sha256(code),
    flow,
    challenge: challenge ?? '',
    user_id: session.userId,
    session_sid: session.sid,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) {
    // Issuance failure must not strand the user — the web session is
    // valid, so landing on the app is the honest outcome.
    delete session.desktopFlow
    await session.save()
    res.writeHead(302, { Location: webLocation })
    res.end()
    return true
  }
  await session.save()
  res.writeHead(302, { Location: desktopDeepLink(flow, code) })
  res.end()
  return true
}

// A second browser request can reach the OAuth callback with the ORIGINAL
// sealed cookie while the first request is already using the GitHub code.
// GitHub then says bad_verification_code. Only recover when the first request
// has ACTUALLY issued this precise code, bound to the same flow+challenge.
// Never allow a token rejection on its own to create an authenticated handoff.
// The PKCE verifier remains necessary for the app to redeem the recovered URL.
export async function recoverCompletedDesktopHandoff(res, session, oauthCode, {
  attempts = 12,
  delayMs = 500,
} = {}) {
  const flow = session?.desktopFlow
  const challenge = session?.desktopChallenge
  const code = oauthDesktopHandoffCode(oauthCode, flow, challenge)
  if (!supabase || !code) return false
  const codeHash = sha256(code)
  const boundedAttempts = Math.max(1, Math.min(16, Math.floor(attempts)))
  for (let n = 0; n < boundedAttempts; n++) {
    const { data, error } = await supabase.from(CODES_TABLE)
      .select('code_hash')
      .eq('code_hash', codeHash)
      .eq('flow', flow)
      .eq('challenge', challenge)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (!error && data?.code_hash === codeHash) {
      res.writeHead(302, {
        Location: desktopDeepLink(flow, code),
        'Cache-Control': 'private, no-store, max-age=0',
      })
      res.end()
      return true
    }
    // Allow the successful callback time to finish provisioning the user,
    // creating its server-side session, and inserting the handoff row.
    if (n + 1 < boundedAttempts && !error) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(1000, delayMs))))
    } else if (error) {
      break
    }
  }
  return false
}

// Atomically consume a handoff code: a single UPDATE ... RETURNING guarded
// by consumed_at IS NULL — Postgres serializes the row lock and
// re-evaluates the predicate, so concurrent exchanges can never both
// succeed. The PKCE verifier is bound INTO the guarded update: the
// challenge hash lives in the row, so a stolen dev-ledger:// URL (which
// leaks flow+code but not the verifier) fails the match and stays dead.
// Returns { userId, sessionSid } or null.
export async function consumeDesktopCode(code, flow, verifier) {
  if (!supabase || !CODE_RE.test(code || '') || !isDesktopFlowId(flow)
    || !VERIFIER_RE.test(verifier || '')) return null
  const { data, error } = await supabase
    .from(CODES_TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', sha256(code))
    .eq('flow', flow)
    .eq('challenge', sha256(verifier))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id, session_sid')
  if (error || !data?.length) return null
  return { userId: data[0].user_id, sessionSid: data[0].session_sid }
}

// Mint an opaque bearer token bound to a dedicated server-side session.
// Only the hash is stored; the plaintext is returned once to the caller.
export async function issueDesktopToken(userId, sessionSid) {
  if (!supabase) return null
  const token = newSecret('dlt', 32)
  const { error } = await supabase.from(TOKENS_TABLE).insert({
    token_hash: sha256(token),
    user_id: userId,
    session_sid: sessionSid,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  })
  if (error) return null
  return token
}

// Resolve an Authorization: Bearer dlt_... header to an authenticated
// principal, or null. The token row must be live AND its bound
// auth_sessions row must be live — the same revocation guarantee the
// sealed cookie gets. Returns { userId, sid } on success.
export async function authenticateBearer(req) {
  const header = req?.headers?.authorization
  if (!supabase || typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!TOKEN_RE.test(token)) return null
  const tokenHash = sha256(token)
  const { data } = await supabase
    .from(TOKENS_TABLE)
    .select('user_id, session_sid')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!data || !(await isSessionLive(data.session_sid))) return null
  return { userId: data.user_id, sid: data.session_sid, tokenHash }
}

// Revoke a single token by its hash plus the session it was bound to —
// desktop sign-out kills both, exactly like the web logout kills the
// cookie + auth_sessions row.
export async function revokeDesktopToken(tokenHash, sessionSid) {
  if (!supabase || !tokenHash) return
  await supabase.from(TOKENS_TABLE).delete().eq('token_hash', tokenHash)
  if (sessionSid) {
    await supabase.from('auth_sessions').delete().eq('sid', sessionSid)
  }
}

// Bounded retention: dead codes (expired or already consumed) and expired
// tokens are removed outright — a missing row fails validation identically.
// Called opportunistically on exchange, never per request.
export async function gcDesktopAuth() {
  if (!supabase) return
  const now = new Date().toISOString()
  try {
    await supabase
      .from(CODES_TABLE)
      .delete()
      .or(`expires_at.lt.${now},consumed_at.gte.1970-01-01T00:00:00.000Z`)
    await supabase.from(TOKENS_TABLE).delete().lt('expires_at', now)
  } catch {
    /* GC is best-effort — next exchange retries */
  }
}
