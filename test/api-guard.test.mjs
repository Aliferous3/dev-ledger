import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appUrl } from '../lib/config.mjs'
import { requireUser } from '../lib/require-user.mjs'
import dashboardHandler from '../api/dashboard.mjs'
import syncHandler from '../api/sync.mjs'
import userHandler from '../api/user.mjs'
import webhookHandler from '../api/webhooks/github.mjs'

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    _headers: {},
    status(code) { this.statusCode = code; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v },
    getHeader(k) { return this._headers[k.toLowerCase()] },
    getHeaders() { return this._headers },
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this._headers, h); return this },
    end() { return this },
  }
}

function mockReq(overrides = {}) {
  // Handlers read query via requestQuery(req) (WHATWG URL over req.url) —
  // translate the legacy `query` override into the real url so tests match.
  const { query, ...rest } = overrides
  const req = { method: 'GET', headers: {}, ...rest }
  if (query && Object.keys(query).length) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) params.set(k, v)
    req.url = `${req.url?.split('?')[0] || '/'}?${params}`
  }
  return req
}

test('unauthenticated requests are rejected with 401', async () => {
  for (const handler of [dashboardHandler, syncHandler]) {
    const res = mockRes()
    await handler(mockReq(), res)
    assert.equal(res.statusCode, 401)
  }
})

test('unauthenticated /api/user reports not authenticated', async () => {
  const res = mockRes()
  await userHandler(mockReq(), res)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.authenticated, false)
})

test('unauthenticated DELETE /api/user is rejected', async () => {
  const res = mockRes()
  // valid same-origin headers so the request reaches the auth check —
  // the CSRF layer's 403s are covered by the same-origin suite
  await userHandler(
    mockReq({ method: 'DELETE', headers: { origin: new URL(appUrl).origin }, query: { confirm: '1' } }),
    res,
  )
  assert.equal(res.statusCode, 401)
})

test('requireUser returns null and sends 401 without a session', async () => {
  const res = mockRes()
  const userId = await requireUser(mockReq(), res)
  assert.equal(userId, null)
  assert.equal(res.statusCode, 401)
})

test('webhook rejects unsigned requests', async () => {
  const req = mockReq({ method: 'POST', headers: { 'x-github-event': 'push' } })
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from('{}') }
  const res = mockRes()
  await webhookHandler(req, res)
  assert.equal(res.statusCode, 401)
})
