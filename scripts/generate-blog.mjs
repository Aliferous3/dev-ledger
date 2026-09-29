import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_DIR = path.join(ROOT, 'content', 'blog')
const BLOG_DIR = path.join(ROOT, 'blog')
const PUBLIC_DIR = path.join(ROOT, 'public')
const SITE = 'https://devledger.site'
const DEFAULT_OG_IMAGE = '/og/dev-ledger.png'

// Curated related-articles map: slug -> up to 3 related slugs, chosen
// editorially from article content/tags. Deterministic by construction —
// every entry is validated against the published slug set at build time
// (unknown slug, self-reference, or duplicate fails the build).
const RELATED_ARTICLES = {
  'analyze-github-development-history': [
    'github-analytics-metrics-guide',
    'git-commit-history-analysis',
    'developer-productivity-metrics',
  ],
  'analyze-programming-language-usage-github': [
    'measure-source-code-growth-over-time',
    'repository-lifecycle-analytics',
    'github-analytics-metrics-guide',
  ],
  'compare-github-activity-time-ranges': [
    'github-analytics-metrics-guide',
    'repository-lifecycle-analytics',
    'github-contribution-graph-limitations',
  ],
  'developer-productivity-metrics': [
    'what-is-code-churn',
    'github-analytics-metrics-guide',
    'git-commit-history-analysis',
  ],
  'git-commit-history-analysis': [
    'repository-lifecycle-analytics',
    'github-contribution-graph-limitations',
    'developer-productivity-metrics',
  ],
  'github-analytics-metrics-guide': [
    'developer-productivity-metrics',
    'what-is-code-churn',
    'compare-github-activity-time-ranges',
  ],
  'github-contribution-graph-limitations': [
    'github-analytics-metrics-guide',
    'compare-github-activity-time-ranges',
    'privacy-first-github-analytics',
  ],
  'measure-source-code-growth-over-time': [
    'what-is-code-churn',
    'analyze-programming-language-usage-github',
    'repository-lifecycle-analytics',
  ],
  'privacy-first-github-analytics': [
    'github-analytics-metrics-guide',
    'analyze-github-development-history',
    'what-is-code-churn',
  ],
  'repository-lifecycle-analytics': [
    'git-commit-history-analysis',
    'measure-source-code-growth-over-time',
    'compare-github-activity-time-ranges',
  ],
  'what-is-code-churn': [
    'developer-productivity-metrics',
    'git-commit-history-analysis',
    'measure-source-code-growth-over-time',
  ],
}

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const escapeXml = escapeHtml

function pngSize(rel) {
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, rel.replace(/^\/+/, '')))
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(12) === 0x49484452) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
  } catch {}
  return null
}

const DEFAULT_OG_SIZE = pngSize(DEFAULT_OG_IMAGE)

function parseFrontmatter(source, file) {
  if (!source.startsWith('---\n')) throw new Error(file + ': missing frontmatter')
  const end = source.indexOf('\n---\n', 4)
  if (end < 0) throw new Error(file + ': unterminated frontmatter')
  const raw = source.slice(4, end)
  const body = source.slice(end + 5).trim()
  const meta = {}
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx < 1) continue
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  for (const key of ['slug', 'title', 'description', 'date', 'author']) {
    if (!meta[key]) throw new Error(file + ': missing ' + key)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) throw new Error(file + ': invalid slug ' + meta.slug)
  const tags = (meta.tags || '').split(',').map((x) => x.trim()).filter(Boolean)
  return { ...meta, tags, body, file }
}

function inline(text) {
  let out = escapeHtml(text)
  out = out.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = href.startsWith('/') || href.startsWith('https://') ? href : '#'
    const external = target.startsWith('https://') && !target.startsWith(SITE)
    return '<a href="' + escapeHtml(target) + '"' + (external ? ' rel="noreferrer"' : '') + '>' + label + '</a>'
  })
  return out
}

function headingId(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/)
  const out = []
  let paragraph = []
  let list = null
  let code = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push('<p>' + inline(paragraph.join(' ')) + '</p>')
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    out.push('<' + list.type + '>' + list.items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + list.type + '>')
    list = null
  }

  for (const line of lines) {
    if (code) {
      if (line.startsWith('~~~')) {
        out.push('<pre><code>' + escapeHtml(code.lines.join('\n')) + '</code></pre>')
        code = null
      } else code.lines.push(line)
      continue
    }
    if (line.startsWith('~~~')) {
      flushParagraph()
      flushList()
      code = { lines: [] }
      continue
    }
    const heading = line.match(/^(##|###)\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const text = heading[2].trim()
      out.push('<h' + level + ' id="' + headingId(text) + '">' + inline(text) + '</h' + level + '>')
      continue
    }
    const bullet = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (bullet || ordered) {
      flushParagraph()
      const type = ordered ? 'ol' : 'ul'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [] }
      }
      list.items.push((bullet || ordered)[1])
      continue
    }
    const quote = line.match(/^>\s?(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      out.push('<blockquote>' + inline(quote[1]) + '</blockquote>')
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  if (code) out.push('<pre><code>' + escapeHtml(code.lines.join('\n')) + '</code></pre>')
  return out.join('\n')
}

function readPosts() {
  if (!fs.existsSync(CONTENT_DIR)) return []
  return fs.readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const file = path.join(CONTENT_DIR, name)
      const post = parseFrontmatter(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), name)
      const words = post.body.trim().split(/\s+/).filter(Boolean).length
      const ogPath = post.ogImage || DEFAULT_OG_IMAGE
      const ogExternal = ogPath.startsWith('http')
      return {
        ...post,
        url: SITE + '/blog/' + post.slug,
        ogImageUrl: ogExternal ? ogPath : SITE + ogPath,
        ogImageSize: ogExternal ? null : pngSize(ogPath),
        banner: !ogExternal && ogPath !== DEFAULT_OG_IMAGE ? ogPath : null,
        readMinutes: Math.max(1, Math.ceil(words / 220)),
        html: markdownToHtml(post.body),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

// Resolve and validate the curated related-articles map. Every article
// gets up to 3 related posts; a bad entry fails the build rather than
// shipping a broken or self-referencing link.
function attachRelated(posts) {
  const bySlug = new Map(posts.map((p) => [p.slug, p]))
  for (const post of posts) {
    const related = RELATED_ARTICLES[post.slug] || []
    if (related.length > 3) throw new Error(post.slug + ': more than 3 related articles')
    const seen = new Set()
    post.related = related.map((slug) => {
      if (!bySlug.has(slug)) throw new Error(post.slug + ': unknown related slug ' + slug)
      if (slug === post.slug) throw new Error(post.slug + ': self-referencing related article')
      if (seen.has(slug)) throw new Error(post.slug + ': duplicate related slug ' + slug)
      seen.add(slug)
      return bySlug.get(slug)
    })
  }
  return posts
}

function head({ title, description, canonical, ogImage, ogImageAlt = '', ogImageSize = null, type = 'website', post = null }) {
  const imageMeta = [
    ogImageSize ? '<meta property="og:image:type" content="image/png" />' : null,
    ogImageSize ? '<meta property="og:image:width" content="' + ogImageSize.width + '" />' : null,
    ogImageSize ? '<meta property="og:image:height" content="' + ogImageSize.height + '" />' : null,
    ogImageAlt ? '<meta property="og:image:alt" content="' + escapeHtml(ogImageAlt) + '" />' : null,
  ].filter(Boolean).join('\n    ')
  const twitterImageAlt = ogImageAlt
    ? '<meta name="twitter:image:alt" content="' + escapeHtml(ogImageAlt) + '" />'
    : ''
  const articleMeta = post ? [
    '<meta property="article:published_time" content="' + escapeHtml(post.date) + '" />',
    '<meta property="article:modified_time" content="' + escapeHtml(post.updated || post.date) + '" />',
    '<meta property="article:author" content="' + escapeHtml(post.author) + '" />',
    ...post.tags.map((tag) => '<meta property="article:tag" content="' + escapeHtml(tag) + '" />'),
  ].join('\n    ') : ''
  return `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="color-scheme" content="dark" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" type="application/rss+xml" title="Dev Ledger Blog RSS" href="${SITE}/rss.xml" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="Dev Ledger" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    ${imageMeta}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
    ${twitterImageAlt}
    ${articleMeta}
    <link rel="stylesheet" href="/src/blog/blog.css" />
    <script type="module" src="/src/blog/analytics.ts"></script>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230a0a0a'/%3E%3Crect x='5' y='5' width='6' height='6' fill='%23d6ff3e'/%3E%3C/svg%3E" />`
}

function shell(body, opts) {
  return `<!doctype html>
<html lang="en">
  <head>
    ${head(opts)}
  </head>
  <body>
    ${body}
  </body>
</html>
`
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'))
}

function siteChrome(inner) {
  return `<div class="site-shell">
    <header class="topbar">
      <a class="brand" href="/">DEV LEDGER</a>
      <nav aria-label="Primary">
        <a href="/blog" aria-current="page">BLOG</a>
        <a href="/security">SECURITY</a>
        <a href="https://github.com/Aliferous3/dev-ledger" rel="noreferrer">SOURCE</a>
      </nav>
    </header>
    ${inner}
    <footer class="site-footer">
      <span>DEV LEDGER / JOURNAL</span>
      <span><a href="/rss.xml">RSS</a> · <a href="/">OPEN DEV LEDGER</a></span>
    </footer>
  </div>`
}

function renderIndex(posts) {
  const cards = posts.map((post, i) => `
      <article class="post-row">
        <div class="post-index">${String(i + 1).padStart(2, '0')}</div>
        <div>
          <div class="post-meta">${escapeHtml(formatDate(post.date).toUpperCase())} · ${post.readMinutes} MIN READ</div>
          <h2><a href="/blog/${escapeHtml(post.slug)}" data-index-target="${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.description)}</p>
          <div class="tags">${post.tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('')}</div>
        </div>
      </article>`).join('')

  const body = siteChrome(`
    <main class="blog-index">
      <section class="blog-hero">
        <div class="eyebrow">DEV LEDGER / JOURNAL</div>
        <h1>Notes on development<br/>as a body of work.</h1>
        <p>Practical writing about GitHub history, code metrics, developer analytics, privacy, and the systems behind Dev Ledger.</p>
        <div class="hero-meta"><span>${posts.length} ARTICLE${posts.length === 1 ? '' : 'S'}</span><span>OPEN SOURCE</span><span>RSS AVAILABLE</span></div>
      </section>
      <section class="post-list" aria-label="Articles">
        ${cards}
      </section>
    </main>`)
  return shell(body, {
    title: 'Dev Ledger Blog — GitHub History & Developer Analytics',
    description: 'Practical writing about GitHub history, code metrics, developer analytics, privacy, and the systems behind Dev Ledger.',
    canonical: SITE + '/blog',
    ogImage: SITE + DEFAULT_OG_IMAGE,
    ogImageAlt: 'Dev Ledger Blog — GitHub History & Developer Analytics',
    ogImageSize: DEFAULT_OG_SIZE,
  })
}

function renderRelated(post) {
  if (!post.related.length) return ''
  const items = post.related.map((r) => `
          <li class="related-item">
            <a href="/blog/${escapeHtml(r.slug)}" data-related-target="${escapeHtml(r.slug)}">
              <span class="related-meta">${escapeHtml(formatDate(r.date).toUpperCase())} · ${r.readMinutes} MIN READ</span>
              <span class="related-title">${escapeHtml(r.title)}</span>
              <span class="related-desc">${escapeHtml(r.description)}</span>
            </a>
          </li>`).join('')
  return `<section class="related-articles" aria-labelledby="related-articles-heading">
        <div class="eyebrow">RELATED ARTICLES</div>
        <h2 id="related-articles-heading">Keep reading</h2>
        <ol class="related-list">${items}
        </ol>
      </section>`
}

function renderBreadcrumbs(post) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList">
      <ol>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <a itemprop="item" href="${SITE}/"><span itemprop="name">Dev Ledger</span></a>
          <meta itemprop="position" content="1" />
        </li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <a itemprop="item" href="${SITE}/blog"><span itemprop="name">Blog</span></a>
          <meta itemprop="position" content="2" />
        </li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <span itemprop="name">${escapeHtml(post.title)}</span>
          <meta itemprop="item" content="${escapeHtml(post.url)}" />
          <meta itemprop="position" content="3" />
        </li>
      </ol>
    </nav>`
}

function renderArticle(post) {
  const body = siteChrome(`
    <main class="article-wrap">
      ${renderBreadcrumbs(post)}
      <article class="article" data-slug="${escapeHtml(post.slug)}" itemscope itemtype="https://schema.org/BlogPosting">
        <meta itemprop="mainEntityOfPage" content="${escapeHtml(post.url)}" />
        <meta itemprop="datePublished" content="${escapeHtml(post.date)}" />
        <meta itemprop="dateModified" content="${escapeHtml(post.updated || post.date)}" />
        <meta itemprop="author" content="${escapeHtml(post.author)}" />
        <meta itemprop="publisher" content="Dev Ledger" />
        <meta itemprop="image" content="${escapeHtml(post.ogImageUrl)}" />
        ${post.banner ? '<img class="article-banner" src="' + escapeHtml(post.banner) + '" alt="' + escapeHtml(post.title) + '"' + (post.ogImageSize ? ' width="' + post.ogImageSize.width + '" height="' + post.ogImageSize.height + '"' : '') + ' fetchpriority="high" />' : ''}
        <header class="article-header">
          <div class="eyebrow">JOURNAL / ${escapeHtml(post.tags[0] || 'DEV LEDGER')}</div>
          <h1 itemprop="headline">${escapeHtml(post.title)}</h1>
          <p class="dek" itemprop="description">${escapeHtml(post.description)}</p>
          <div class="article-meta">
            <span>BY ${escapeHtml(post.author.toUpperCase())}</span>
            <span>${escapeHtml(formatDate(post.date).toUpperCase())}</span>
            <span>${post.readMinutes} MIN READ</span>
          </div>
        </header>
        <div class="article-body" itemprop="articleBody">
          ${post.html}
        </div>
        ${renderRelated(post)}
        <footer class="article-end">
          <span>END OF RECORD</span>
          <a class="article-cta" href="/" data-cta="article_end">SEE YOUR GITHUB HISTORY IN DEV LEDGER →</a>
        </footer>
      </article>
    </main>`)
  return shell(body, {
    title: post.title + ' — Dev Ledger',
    description: post.description,
    canonical: post.url,
    ogImage: post.ogImageUrl,
    ogImageAlt: post.title,
    ogImageSize: post.ogImageSize,
    type: 'article',
    post,
  })
}

function writeGenerated(posts) {
  fs.rmSync(BLOG_DIR, { recursive: true, force: true })
  fs.mkdirSync(BLOG_DIR, { recursive: true })
  fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), renderIndex(posts))
  for (const post of posts) {
    const dir = path.join(BLOG_DIR, post.slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), renderArticle(post))
  }

  const latest = posts[0]?.date || '2026-09-28'
  const urls = [
    ['/', '2026-09-28'],
    ['/security', '2026-09-28'],
    ['/privacy', '2026-09-28'],
    ['/terms', '2026-09-28'],
    ['/blog', latest],
    ...posts.map((p) => ['/blog/' + p.slug, p.updated || p.date]),
  ]
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([url, modified]) => `  <url>
    <loc>${SITE}${url}</loc>
    <lastmod>${modified}</lastmod>
  </url>`).join('\n')}
</urlset>
`
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap)

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dev Ledger Blog</title>
    <link>${SITE}/blog</link>
    <description>Writing about GitHub history, code metrics, developer analytics, privacy, and Dev Ledger.</description>
    <language>en</language>
    <lastBuildDate>${new Date(latest + 'T00:00:00Z').toUTCString()}</lastBuildDate>
${posts.map((p) => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${p.url}</link>
      <guid isPermaLink="true">${p.url}</guid>
      <pubDate>${new Date(p.date + 'T00:00:00Z').toUTCString()}</pubDate>
      <description>${escapeXml(p.description)}</description>
      <author>${escapeXml(p.author)}</author>
${p.tags.map((tag) => '      <category>' + escapeXml(tag) + '</category>').join('\n')}
    </item>`).join('\n')}
  </channel>
</rss>
`
  fs.writeFileSync(path.join(PUBLIC_DIR, 'rss.xml'), rss)
}

const posts = attachRelated(readPosts())
if (!posts.length) throw new Error('At least one blog post is required')
writeGenerated(posts)
console.log('Generated blog:', posts.map((p) => p.slug).join(', '))
