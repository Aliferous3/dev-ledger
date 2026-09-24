import { appUrl } from './config.mjs'
import { securityEvent } from './security-events.mjs'

// Same-origin guard for browser-triggered state-changing routes.
//
// CSRF model: a sealed session cookie is ambient — any cross-site page can
// cause the browser to send it (top-level POST form, fetch, preflight-free
// requests). The Origin header is the reliable discriminator: browsers send
// it on every cross-origin state-changing request and on same-origin
// POST/DELETE fetches. Referer is NOT a fallback (it can be stripped
// legitimately) and Host/X-Forwarded-Host is NOT trusted (attacker-
// controllable through misconfigured proxies) — the configured APP_URL is
// the single source of truth for our origin.
//
// Rules:
//   1. Origin must be present and parse to exactly our configured origin.
//   2. If Sec-Fetch-Site is present it must be 'same-origin' — a valid
//      Origin smuggled into a cross-site context still dies here.
//   3. Missing or malformed Origin fails closed (403).
//
// Exempt by design (callers must not wire this in): the GitHub webhook
// (HMAC signature), cron (CRON_SECRET), and the OAuth/setup redirect
// endpoints (GitHub navigates to them — no Origin is sent).
const expectedOrigin = new URL(appUrl).origin

function blockReason(req) {
  const origin = req?.headers?.origin
  if (!origin) return 'origin_missing'
  let actual
  try {
    actual = new URL(origin).origin
  } catch {
    return 'origin_malformed'
  }
  if (actual !== expectedOrigin) return 'origin_mismatch'
  const fetchSite = req.headers?.['sec-fetch-site']
  if (fetchSite != null && fetchSite !== 'same-origin') return 'fetch_site_mismatch'
  return null
}

export function isSameOrigin(req) {
  return blockReason(req) === null
}

// Sends 403 and returns true when the request is cross-origin — callers:
//   if (forbidCrossSite(req, res)) return
// The single emit point for CSRF rejections across every guarded route —
// callers must not log the same rejection again.
export function forbidCrossSite(req, res) {
  const reason = blockReason(req)
  if (reason === null) return false
  securityEvent('same_origin_blocked', {
    req, status: 403, severity: 'warning', reasonCode: reason,
  })
  res.status(403).json({ error: 'Forbidden' })
  return true
}
