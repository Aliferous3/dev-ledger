import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  return { method: 'GET', headers: {}, query: {}, ...overrides }
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
  await userHandler(mockReq({ method: 'DELETE', query: { confirm: '1' } }), res)
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
