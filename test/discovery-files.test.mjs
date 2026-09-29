import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

const articleSlugs = () =>
  readdirSync(new URL('../content/blog', import.meta.url))
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.replace(/\.md$/, ''))

test('sitemap exposes only canonical public pages and has a human stylesheet', () => {
  const sitemap = src('public/sitemap.xml')
  assert.ok(sitemap.includes('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'))
  for (const url of [
    'https://devledger.site/',
    'https://devledger.site/security',
    'https://devledger.site/privacy',
    'https://devledger.site/terms',
    'https://devledger.site/blog',
    'https://devledger.site/blog/analyze-github-development-history',
  ]) assert.ok(sitemap.includes(url), 'missing sitemap URL: ' + url)
  assert.ok(!sitemap.includes('/api/'))
  assert.ok(!sitemap.includes('/overview'))
  assert.ok(!sitemap.includes('/activity'))
  assert.ok(!sitemap.includes('/code'))
})

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

test('llms.txt follows the discovery manifest contract', () => {
  const llms = src('public/llms.txt')
  assert.ok(llms.startsWith('# Dev Ledger\n'))
  assert.ok(llms.includes('> Dev Ledger is an open-source developer analytics application'))
  assert.ok(llms.includes('https://devledger.site/security'))
  assert.ok(llms.includes('https://devledger.site/blog'))
  assert.ok(llms.includes('https://github.com/Aliferous3/dev-ledger'))
  assert.ok(llms.includes('does not persist repository source code'))
  assert.ok(llms.includes('## Discovery'))
})

test('sitemap presentation assets exist and llms discovery is advertised by HTTP config', () => {
  const xsl = src('public/sitemap.xsl')
  const css = src('public/sitemap.css')
  const vercel = src('vercel.json')
  assert.ok(xsl.includes('DEV LEDGER / DISCOVERY'))
  assert.ok(xsl.includes('href="/sitemap.css"'))
  assert.ok(css.includes('#d6ff3e'))
  assert.ok(vercel.includes('</llms.txt>; rel=\\"describedby\\"; type=\\"text/markdown\\"'))
})

test('blog discovery exposes RSS and keeps authenticated routes out of the sitemap', () => {
  const sitemap = src('public/sitemap.xml')
  const rss = src('public/rss.xml')
  assert.ok(sitemap.includes('https://devledger.site/blog'))
  assert.ok(sitemap.includes('https://devledger.site/blog/analyze-github-development-history'))
  assert.ok(!sitemap.includes('https://devledger.site/overview'))
  assert.ok(!sitemap.includes('https://devledger.site/activity'))
  assert.ok(!sitemap.includes('https://devledger.site/code'))
  assert.ok(rss.includes('<title>Dev Ledger Blog</title>'))
  assert.ok(rss.includes('How to Analyze Your GitHub Development History'))
})

test('sitemap and RSS contain every published article exactly once', () => {
  const sitemap = src('public/sitemap.xml')
  const rss = src('public/rss.xml')
  const slugs = articleSlugs()
  assert.ok(slugs.length >= 11, 'expected all published articles to be discovered')
  for (const slug of slugs) {
    const loc = '<loc>https://devledger.site/blog/' + slug + '</loc>'
    const count = sitemap.split(loc).length - 1
    assert.equal(count, 1, 'sitemap must contain ' + slug + ' exactly once')
    const item = '<guid isPermaLink="true">https://devledger.site/blog/' + slug + '</guid>'
    const items = rss.split(item).length - 1
    assert.equal(items, 1, 'rss must contain ' + slug + ' exactly once')
  }
  assert.ok(!sitemap.includes('localhost'), 'no localhost in sitemap')
  assert.ok(!sitemap.includes('vercel.app'), 'no preview hosts in sitemap')
  assert.ok(!rss.includes('localhost'), 'no localhost in rss')
})
