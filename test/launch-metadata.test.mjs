import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const has = (p) => existsSync(path.join(root, p));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const metaPair = (attr, name, value) =>
  new RegExp(`${attr}="${name}"\\s+content="${esc(value)}"`);

// Page → canonical OG asset mapping. Dimensions are the real pixel size of
// each shipped PNG — the metadata must describe the bytes, not a template.
const OG_PAGES = [
  {
    html: 'index.html',
    asset: 'public/og/dev-ledger.png',
    url: 'https://devledger.site/og/dev-ledger.png',
    width: '1672',
    height: '941',
    alt: 'Dev Ledger — open-source GitHub developer analytics.',
    canonical: 'https://devledger.site/',
    title: 'Dev Ledger — Code Metrics',
  },
  {
    html: 'security.html',
    asset: 'public/og/security.png',
    url: 'https://devledger.site/og/security.png',
    width: '1731',
    height: '909',
    alt: 'Dev Ledger Security & Privacy.',
    canonical: 'https://devledger.site/security',
    title: 'Security & Privacy — Dev Ledger',
  },
  {
    html: 'privacy.html',
    asset: 'public/og/privacy.png',
    url: 'https://devledger.site/og/privacy.png',
    width: '1731',
    height: '909',
    alt: 'Dev Ledger Privacy Policy.',
    canonical: 'https://devledger.site/privacy',
    title: 'Privacy Policy — Dev Ledger',
  },
  {
    html: 'terms.html',
    asset: 'public/og/terms.png',
    url: 'https://devledger.site/og/terms.png',
    width: '1731',
    height: '909',
    alt: 'Dev Ledger Terms of Service.',
    canonical: 'https://devledger.site/terms',
    title: 'Terms of Service — Dev Ledger',
  },
];

test('launch metadata exposes canonical Open Graph and Twitter cards', () => {
  const html = src('index.html');

  assert.match(html, /<link rel="canonical" href="https:\/\/devledger\.site\/" \/>/);
  assert.match(html, /property="og:title" content="Dev Ledger — Code Metrics"/);
  assert.match(html, /property="og:image" content="https:\/\/devledger\.site\/og\/dev-ledger\.png"/);
  assert.match(html, /property="og:image:width" content="1672"/);
  assert.match(html, /property="og:image:height" content="941"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/devledger\.site\/og\/dev-ledger\.png"/);
  assert.match(html, /name="theme-color" content="#0a0a0a"/);
});

test('every public route ships its own page-specific OG image', () => {
  for (const page of OG_PAGES) {
    const html = src(page.html);
    const name = page.html;

    assert.ok(
      html.includes(`property="og:image" content="${page.url}"`),
      name + ' og:image',
    );
    assert.ok(
      html.includes(`name="twitter:image" content="${page.url}"`),
      name + ' twitter:image must match og:image',
    );
    assert.ok(
      html.includes(`property="og:image:type" content="image/png"`),
      name + ' og:image:type',
    );
    assert.ok(
      html.includes(`property="og:image:width" content="${page.width}"`),
      name + ' og:image:width',
    );
    assert.ok(
      html.includes(`property="og:image:height" content="${page.height}"`),
      name + ' og:image:height',
    );
    assert.ok(
      metaPair('property', 'og:image:alt', page.alt).test(html),
      name + ' og:image:alt',
    );
    assert.ok(
      metaPair('name', 'twitter:image:alt', page.alt).test(html),
      name + ' twitter:image:alt must match og:image:alt',
    );
    assert.ok(
      html.includes(`<link rel="canonical" href="${page.canonical}" />`),
      name + ' canonical',
    );
    assert.ok(
      html.includes(`property="og:url" content="${page.canonical}"`),
      name + ' og:url',
    );
    // The retired catch-all card must not linger in any shell.
    assert.ok(
      !html.includes('https://devledger.site/og.png'),
      name + ' still references retired /og.png',
    );
  }
});

test('OG image assets exist in the source tree and the production build', () => {
  for (const page of OG_PAGES) {
    assert.ok(has(page.asset), 'missing source asset: ' + page.asset);
  }

  const distAssets = OG_PAGES.map((p) => 'dist/og/' + path.basename(p.asset));
  if (distAssets.every(has)) return;

  assert.ok(
    !process.env.CI,
    'dist/og/ is incomplete on CI — the build never shipped the OG assets. ' +
      'Run `npm run build` BEFORE `npm test` in the workflow.',
  );
});

test('public trust and legal routes ship route-specific crawl-time metadata', () => {
  const cases = OG_PAGES.filter((p) => p.html !== 'index.html');

  for (const page of cases) {
    const html = src(page.html);
    assert.ok(html.includes(`<title>${page.title}</title>`), page.html + ' title');
    assert.ok(html.includes(`<link rel="canonical" href="${page.canonical}" />`), page.html + ' canonical');
    assert.ok(html.includes(`property="og:url" content="${page.canonical}"`), page.html + ' og:url');
    assert.ok(html.includes(`property="og:title" content="${page.title}"`), page.html + ' og:title');
    assert.ok(html.includes(`name="twitter:title" content="${page.title}"`), page.html + ' twitter:title');
    assert.ok(html.includes(page.url), page.html + ' social image');
    assert.ok(html.includes('name="robots" content="index,follow"'), page.html + ' robots');
  }
});

test('retired /og.png dynamic social-card pipeline is fully removed', () => {
  const vercel = src('vercel.json');
  const user = src('api/user.mjs');

  assert.ok(!vercel.includes('"/og.png"'), 'vercel.json still rewrites /og.png');
  assert.ok(!vercel.includes('action=social-card'), 'vercel.json still routes to social-card');
  assert.ok(!user.includes('social-card'), 'api/user.mjs still handles social-card');
  assert.ok(!user.includes('social_card'), 'api/user.mjs still handles social_card');
  assert.ok(!has('lib/social-card.mjs'), 'lib/social-card.mjs still exists');
});

test('vite builds dedicated public-route HTML entry points', () => {
  const vite = src('vite.config.ts');
  for (const file of ['index.html', 'security.html', 'privacy.html', 'terms.html']) {
    assert.ok(vite.includes(file), 'missing Vite input: ' + file);
  }
});
