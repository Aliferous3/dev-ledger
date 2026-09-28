import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('sitemap exposes only canonical public pages and has a human stylesheet', () => {
  const sitemap = src('public/sitemap.xml')
  assert.ok(sitemap.includes('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'))
  for (const url of [
    'https://devledger.site/',
    'https://devledger.site/security',
    'https://devledger.site/privacy',
    'https://devledger.site/terms',
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
