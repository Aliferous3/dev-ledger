<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="s">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex,follow"/>
        <title>Dev Ledger — Sitemap</title>
        <link rel="stylesheet" href="/sitemap.css"/>
      </head>
      <body>
        <main class="shell">
          <header class="masthead">
            <div class="eyebrow">DEV LEDGER / DISCOVERY</div>
            <h1>SITEMAP</h1>
            <p>A machine-readable index of Dev Ledger's public, crawlable pages.</p>
            <div class="meta">
              <span>XML / SITEMAP 0.9</span>
              <span><xsl:value-of select="count(s:urlset/s:url)"/> PUBLIC URLS</span>
              <span>DEVLEDGER.SITE</span>
            </div>
          </header>

          <section class="panel">
            <div class="panel-head">
              <span>INDEX</span>
              <span>LAST MODIFIED</span>
            </div>
            <xsl:for-each select="s:urlset/s:url">
              <a class="row">
                <xsl:attribute name="href"><xsl:value-of select="s:loc"/></xsl:attribute>
                <span class="url"><xsl:value-of select="s:loc"/></span>
                <span class="date"><xsl:value-of select="s:lastmod"/></span>
              </a>
            </xsl:for-each>
          </section>

          <footer>
            <a href="/">DEV LEDGER</a>
            <span>·</span>
            <a href="/robots.txt">ROBOTS.TXT</a>
            <span>·</span>
            <a href="/llms.txt">LLMS.TXT</a>
          </footer>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
