import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(path.join(ROOT, p), 'utf8')

test('blog is source-authored in Markdown and generated before build/test', () => {
  assert.ok(existsSync(path.join(ROOT, 'content/blog/analyze-github-development-history.md')))
  const pkg = JSON.parse(src('package.json'))
  assert.match(pkg.scripts.build, /generate-blog\.mjs/)
  assert.match(pkg.scripts.test, /generate-blog\.mjs/)
  assert.match(pkg.scripts['blog:generate'], /generate-blog\.mjs/)
})

test('generated blog index and first article are crawlable static HTML', () => {
  for (const p of ['blog/index.html', 'blog/analyze-github-development-history/index.html']) {
    assert.ok(existsSync(path.join(ROOT, p)), p)
  }
  const index = src('blog/index.html')
  const article = src('blog/analyze-github-development-history/index.html')
  assert.match(index, /<title>Dev Ledger Blog — GitHub History &amp; Developer Analytics<\/title>/)
  assert.match(index, /rel="canonical" href="https:\/\/devledger\.site\/blog"/)
  assert.match(index, /application\/rss\+xml/)
  assert.match(article, /itemtype="https:\/\/schema\.org\/BlogPosting"/)
  assert.match(article, /itemprop="articleBody"/)
  assert.match(article, /property="og:type" content="article"/)
  assert.match(article, /rel="canonical" href="https:\/\/devledger\.site\/blog\/analyze-github-development-history"/)
  assert.match(article, /How to Analyze Your GitHub Development History/)
})

test('production build contains blog pages and RSS feed', () => {
  for (const p of [
    'dist/blog/index.html',
    'dist/blog/analyze-github-development-history/index.html',
    'dist/rss.xml',
    'dist/sitemap.xml',
  ]) assert.ok(existsSync(path.join(ROOT, p)), p)
})

// Article slug → shipped banner artwork. The same file is the visible
// in-article hero and the og:image / twitter:image social card.
const ARTICLE_BANNERS = [
  'analyze-github-development-history',
  'analyze-programming-language-usage-github',
  'compare-github-activity-time-ranges',
  'developer-productivity-metrics',
  'git-commit-history-analysis',
  'github-contribution-graph-limitations',
  'measure-source-code-growth-over-time',
  'privacy-first-github-analytics',
  'repository-lifecycle-analytics',
  'what-is-code-churn',
]

test('every article ships a banner used in-page and as OG/Twitter image', () => {
  for (const slug of ARTICLE_BANNERS) {
    const asset = 'public/blog/' + slug + '.png'
    const page = 'blog/' + slug + '/index.html'
    assert.ok(existsSync(path.join(ROOT, asset)), asset)
    const html = src(page)
    const url = 'https://devledger.site/blog/' + slug + '.png'
    assert.ok(
      html.includes('<img class="article-banner" src="/blog/' + slug + '.png"'),
      slug + ' renders the banner inside the article',
    )
    assert.ok(
      html.includes('property="og:image" content="' + url + '"'),
      slug + ' og:image',
    )
    assert.ok(
      html.includes('name="twitter:image" content="' + url + '"'),
      slug + ' twitter:image',
    )
    assert.ok(
      html.includes('itemprop="image" content="' + url + '"'),
      slug + ' schema.org image',
    )
    assert.ok(
      html.includes('name="twitter:card" content="summary_large_image"'),
      slug + ' twitter:card',
    )
  }
})

test('articles without custom artwork keep the default OG card and no banner', () => {
  const html = src('blog/github-analytics-metrics-guide/index.html')
  assert.ok(
    html.includes('property="og:image" content="https://devledger.site/og/dev-ledger.png"'),
    'guide og:image falls back to the default card',
  )
  assert.ok(!html.includes('class="article-banner"'), 'guide renders no banner image')
})

test('vercel keeps clean blog URLs and vite builds generated HTML entries', () => {
  const v = JSON.parse(src('vercel.json'))
  assert.ok(v.rewrites.some((r) => r.source === '/blog' && r.destination === '/blog/index.html'))
  assert.ok(v.rewrites.some((r) => r.source === '/blog/:slug' && r.destination === '/blog/:slug/index.html'))
  const vite = src('vite.config.ts')
  assert.match(vite, /blogInputs/)
  assert.match(vite, /\.\.\.blogInputs\(\)/)
})
