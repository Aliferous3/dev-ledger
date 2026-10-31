import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The publishing repository owns the sitemap artifacts; the application
// provides canonical-domain rewrites only. Keep these routes aligned with
// dev-ledger-site and never reintroduce Chrome's deprecated XSLT path.
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

test('canonical domain serves XSLT-free XML and HTML sitemap artifacts', () => {
  const routes = config.rewrites ?? []
  const route = (source) => routes.filter((r) => r.source === source)
  assert.deepEqual(route('/sitemap.xml'), [{
    source: '/sitemap.xml',
    destination: 'https://dev-ledger-site.vercel.app/sitemap.xml',
  }])
  assert.deepEqual(route('/sitemap.html'), [{
    source: '/sitemap.html',
    destination: 'https://dev-ledger-site.vercel.app/sitemap.html',
  }])
  assert.deepEqual(route('/sitemap.css'), [{
    source: '/sitemap.css',
    destination: 'https://dev-ledger-site.vercel.app/sitemap.css',
  }])
  assert.equal(route('/sitemap.xsl').length, 0, 'retired XSLT rewrite must stay removed')
})

test('sitemap rewrites precede unrelated discovery fallback', () => {
  const paths = (config.rewrites ?? []).map((r) => r.source)
  for (const p of ['/sitemap.xml', '/sitemap.html', '/sitemap.css']) {
    assert.ok(paths.indexOf(p) >= 0)
    assert.ok(paths.indexOf(p) < paths.indexOf('/llms.txt'))
  }
})
