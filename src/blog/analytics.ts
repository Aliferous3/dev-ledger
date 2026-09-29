/* Blog analytics wiring for the generated static blog pages.

   The blog is plain HTML — no React — so this module is loaded as a
   deferred <script type="module"> on every generated page. It reuses the
   exact same analytics facade as the app: exact event/property allowlist,
   memory-only persistence, same-origin /rly proxy, silent no-op when no
   project token is configured or init fails.

   Emitted events:
   - blog_article_viewed        (article pages, once per page load)
   - blog_index_article_clicked (index → article navigation)
   - blog_related_article_clicked (related-articles section clicks)
   - blog_product_cta_clicked   (article-end product CTA)

   Only allowlisted slugs/enum values are ever sent — no URLs, referrers,
   titles, or page data. Article views also mark first-party blog
   attribution in sessionStorage so a later GitHub login can be credited. */

import { initAnalytics, captureEvent } from '../analytics/posthog';
import { markBlogAttribution } from '../analytics/blogAttribution';
import { BLOG_ARTICLE_SLUGS } from '../analytics/posthogModel.mjs';

function run(): void {
  const article = document.querySelector<HTMLElement>('article.article');
  const slug = article?.dataset.slug;
  const knownSlug = slug && BLOG_ARTICLE_SLUGS.includes(slug) ? slug : null;

  if (knownSlug) {
    markBlogAttribution(knownSlug);
    captureEvent('blog_article_viewed', { article_slug: knownSlug });
  }

  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a');
    if (!link) return;

    const relatedTarget = link.getAttribute('data-related-target');
    if (relatedTarget && knownSlug) {
      captureEvent('blog_related_article_clicked', {
        origin_slug: knownSlug,
        target_slug: relatedTarget,
        placement: 'related_articles',
      });
      return;
    }

    if (link.getAttribute('data-cta') === 'article_end' && knownSlug) {
      captureEvent('blog_product_cta_clicked', {
        article_slug: knownSlug,
        cta_id: 'article_end',
        placement: 'article_end',
        destination: '/',
      });
      return;
    }

    const indexTarget = link.getAttribute('data-index-target');
    if (indexTarget) {
      captureEvent('blog_index_article_clicked', {
        target_slug: indexTarget,
        placement: 'blog_index',
      });
    }
  });
}

// Wait for the lazy SDK before wiring: view events emitted before init
// resolves would drop. Module scripts are deferred — the DOM is already
// parsed when this runs.
void initAnalytics().then(run).catch(() => {
  /* analytics is best-effort — the blog works identically without it */
});
