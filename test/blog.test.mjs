import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  'github-analytics-metrics-guide',
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

test('every published article ships dedicated artwork — none falls back to the generic card', () => {
  const mdSlugs = readdirSync(path.join(ROOT, 'content/blog'))
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.replace(/\.md$/, ''))
  assert.deepEqual([...mdSlugs].sort(), [...ARTICLE_BANNERS].sort(),
    'every content/blog article must have a dedicated banner entry')
  for (const slug of mdSlugs) {
    const html = src('blog/' + slug + '/index.html')
    assert.ok(
      !html.includes('property="og:image" content="https://devledger.site/og/dev-ledger.png"'),
      slug + ' must not fall back to the default OG card',
    )
    assert.ok(html.includes('class="article-banner"'), slug + ' renders an in-page banner')
  }
})

/* ── Related articles ── */

test('every article exposes a valid related-articles section', () => {
  const slugs = new Set(ARTICLE_BANNERS)
  for (const slug of ARTICLE_BANNERS) {
    const html = src('blog/' + slug + '/index.html')
    assert.ok(html.includes('class="related-articles"'), slug + ' missing related section')
    const targets = [...html.matchAll(/data-related-target="([a-z0-9-]+)"/g)].map((m) => m[1])
    assert.ok(targets.length >= 2 && targets.length <= 3, slug + ' should list 2-3 related articles, got ' + targets.length)
    assert.ok(!targets.includes(slug), slug + ' must not recommend itself')
    assert.equal(new Set(targets).size, targets.length, slug + ' duplicate related targets')
    for (const t of targets) {
      assert.ok(slugs.has(t), slug + ' -> unknown related slug ' + t)
      assert.ok(
        html.includes('href="/blog/' + t + '"'),
        slug + ' related link missing href for ' + t,
      )
    }
  }
})

/* ── Breadcrumbs ── */

test('every article renders a BreadcrumbList with absolute production URLs', () => {
  for (const slug of ARTICLE_BANNERS) {
    const html = src('blog/' + slug + '/index.html')
    assert.ok(html.includes('itemtype="https://schema.org/BreadcrumbList"'), slug + ' missing BreadcrumbList')
    assert.ok(html.includes('aria-label="Breadcrumb"'), slug + ' breadcrumb nav missing label')
    assert.ok(html.includes('itemprop="item" href="https://devledger.site/"'), slug + ' breadcrumb root')
    assert.ok(html.includes('itemprop="item" href="https://devledger.site/blog"'), slug + ' breadcrumb blog')
    assert.ok(html.includes('itemprop="position" content="3"'), slug + ' breadcrumb leaf position')
    assert.ok(html.includes('<meta itemprop="item" content="https://devledger.site/blog/' + slug + '"'), slug + ' breadcrumb leaf item')
  }
})

/* ── Article → product CTA ── */

test('every article ends with one product CTA wired for analytics', () => {
  for (const slug of ARTICLE_BANNERS) {
    const html = src('blog/' + slug + '/index.html')
    assert.ok(html.includes('data-cta="article_end"'), slug + ' missing CTA hook')
    assert.ok(html.includes('SEE YOUR GITHUB HISTORY IN DEV LEDGER'), slug + ' CTA copy')
    const ctas = html.match(/href="\/"[^>]*data-cta="article_end"|data-cta="article_end"[^>]*href="\/"/g) || []
    assert.equal(ctas.length, 1, slug + ' must have exactly one article-end CTA')
  }
})

/* ── Internal links ── */

test('no generated article links to a nonexistent blog slug', () => {
  const slugs = new Set(ARTICLE_BANNERS)
  for (const slug of ARTICLE_BANNERS) {
    const html = src('blog/' + slug + '/index.html')
    for (const m of html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)) {
      assert.ok(slugs.has(m[1]), slug + ' links to unknown article ' + m[1])
    }
  }
  const index = src('blog/index.html')
  const indexTargets = new Set([...index.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]))
  assert.deepEqual([...indexTargets].sort(), [...ARTICLE_BANNERS].sort(),
    'blog index must link every published article exactly')
})

/* ── Analytics wiring on generated pages ── */

test('generated blog pages load the shared analytics module and carry tracking hooks', () => {
  const index = src('blog/index.html')
  assert.ok(index.includes('src="/src/blog/analytics.ts"'), 'index missing analytics module')
  assert.ok(index.includes('data-index-target='), 'index missing click hooks')
  const article = src('blog/what-is-code-churn/index.html')
  assert.ok(article.includes('src="/src/blog/analytics.ts"'), 'article missing analytics module')
  assert.ok(article.includes('data-slug="what-is-code-churn"'), 'article missing slug hook')
  const mod = src('src/blog/analytics.ts')
  assert.match(mod, /captureEvent\('blog_article_viewed'/)
  assert.match(mod, /captureEvent\('blog_index_article_clicked'/)
  assert.match(mod, /captureEvent\('blog_related_article_clicked'/)
  assert.match(mod, /captureEvent\('blog_product_cta_clicked'/)
  assert.match(mod, /initAnalytics\(\)\.then/, 'must wait for lazy SDK before emitting')
  assert.doesNotMatch(mod, /\$pageview|autocapture|identify\(/)
})

test('vercel keeps clean blog URLs and vite builds generated HTML entries', () => {
  const v = JSON.parse(src('vercel.json'))
  assert.ok(v.rewrites.some((r) => r.source === '/blog' && r.destination === '/blog/index.html'))
  assert.ok(v.rewrites.some((r) => r.source === '/blog/:slug' && r.destination === '/blog/:slug/index.html'))
  const vite = src('vite.config.ts')
  assert.match(vite, /blogInputs/)
  assert.match(vite, /\.\.\.blogInputs\(\)/)
})
