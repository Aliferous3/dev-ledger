import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// The production blog/publishing layer lives in the private
// dev-ledger-site repository and is served through devledger.site via
// external rewrites (Vercel checks the local filesystem before rewrites,
// so these paths must NOT exist in this repo's output).
const SITE_ORIGIN = 'https://dev-ledger-site.vercel.app'
const PROXIED_PATHS = [
  '/blog',
  '/rss.xml',
  '/sitemap.xml',
  '/sitemap.xsl',
  '/sitemap.css',
  '/llms.txt',
]

test('robots policy protects app surfaces and advertises search + AI discovery', () => {
  const robots = src('public/robots.txt')
  for (const path of ['/api/', '/rly/', '/overview', '/activity', '/code']) {
    assert.ok(robots.includes('Disallow: ' + path), 'missing protected path: ' + path)
  }
  for (const agent of [
    'OAI-SearchBot', 'GPTBot', 'ChatGPT-User',
    'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
    'PerplexityBot', 'Perplexity-User',
    'Google-Extended', 'Applebot', 'Applebot-Extended',
    'meta-webindexer', 'meta-externalagent', 'meta-externalfetcher',
    'CCBot', 'Bytespider',
  ]) assert.ok(robots.includes('User-agent: ' + agent), 'missing crawler policy: ' + agent)
  assert.ok(robots.includes('Sitemap: https://devledger.site/sitemap.xml'))
})

test('publishing paths proxy to the private site project under unchanged URLs', () => {
  const v = JSON.parse(src('vercel.json'))
  for (const p of PROXIED_PATHS) {
    const rw = v.rewrites.find((r) => r.source === p)
    assert.ok(rw, 'missing external rewrite for ' + p)
    assert.ok(
      rw.destination.startsWith(SITE_ORIGIN),
      p + ' must proxy to the private site project, got ' + rw.destination,
    )
  }
  const blogDeep = v.rewrites.find((r) => r.source === '/blog/:path*')
  assert.equal(blogDeep?.destination, SITE_ORIGIN + '/blog/:path*')
  // Proxied paths must not also exist as local files — the filesystem
  // wins over rewrites, so a stray file would silently shadow the site.
  for (const p of ['public/rss.xml', 'public/sitemap.xml', 'public/llms.txt', 'public/sitemap.xsl', 'public/sitemap.css']) {
    assert.ok(!existsSync(path.join(ROOT, p)), p + ' must not exist locally — it would shadow the site proxy')
  }
  assert.ok(!existsSync(path.join(ROOT, 'blog')), 'blog/ output dir must not exist locally')
  assert.ok(!existsSync(path.join(ROOT, 'content/blog')), 'content/blog must not exist locally')
})

test('llms discovery is still advertised by HTTP config', () => {
  const vercel = src('vercel.json')
  assert.ok(vercel.includes('</llms.txt>; rel=\\"describedby\\"; type=\\"text/markdown\\"'))
})
