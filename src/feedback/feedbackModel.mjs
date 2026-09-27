// Feedback submission contract — shared by the System Drawer UI
// (src/feedback/FeedbackDrawer.tsx) and the POST /api/feedback handler
// (api/user.mjs?action=feedback; a rewrite keeps the project under the
// 12-function Hobby cap). Pure validation only — no I/O.

export const FEEDBACK_TYPES = ['BUG', 'FEATURE', 'FEEDBACK']
export const TITLE_MAX = 200
export const DESCRIPTION_MAX = 4000
export const CONTEXT_FIELD_MAX = 80
export const SCREENSHOT_NAME_MAX = 160
export const SCREENSHOT_MAX_BYTES = 1_000_000
export const SCREENSHOT_MIMES = ['image/png', 'image/jpeg', 'image/webp']

const clip = (v, max) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

// validate + normalize the request payload. Returns { ok, error, value? }.
// Everything optional is sanitized/clamped rather than rejected, except the
// required contract (type in allowlist, non-empty title within bounds).
export function normalizeFeedback(body) {
  const type = String(body?.type || '').toUpperCase()
  if (!FEEDBACK_TYPES.includes(type)) {
    return { ok: false, error: 'type must be BUG, FEATURE, or FEEDBACK' }
  }
  const title = clip(body?.title, TITLE_MAX + 1)
  if (!title) return { ok: false, error: 'title required' }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `title exceeds ${TITLE_MAX} chars` }
  }
  const description = clip(body?.description, DESCRIPTION_MAX + 1)
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `description exceeds ${DESCRIPTION_MAX} chars` }
  }
  return {
    ok: true,
    value: {
      type,
      title,
      description: description || null,
      page: clip(body?.page, CONTEXT_FIELD_MAX) || null,
      selectedRange: clip(body?.range, CONTEXT_FIELD_MAX) || null,
      build: clip(body?.build, CONTEXT_FIELD_MAX) || null,
    },
  }
}

// Screenshot envelope from the client: { name, mime, data (base64) }.
// Byte/mime truth is re-verified server-side against the decoded payload —
// this validates shape and rough size only.
export function normalizeScreenshot(s) {
  if (s == null) return { ok: true, value: null }
  const name = clip(s?.name, SCREENSHOT_NAME_MAX) || 'capture'
  const mime = String(s?.mime || '')
  const data = typeof s?.data === 'string' ? s.data : ''
  if (!SCREENSHOT_MIMES.includes(mime)) {
    return { ok: false, error: 'screenshot must be PNG, JPEG, or WebP' }
  }
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, error: 'screenshot payload malformed' }
  }
  // base64 inflates ~4/3 — bound the decoded size before it is decoded.
  if (data.length > Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4 + 4) {
    return { ok: false, error: `screenshot exceeds ${SCREENSHOT_MAX_BYTES} bytes` }
  }
  return { ok: true, value: { name, mime, data } }
}
