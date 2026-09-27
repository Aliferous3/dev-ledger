import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');

test('launch metadata exposes canonical Open Graph and Twitter cards', () => {
  const html = src('index.html');

  assert.match(html, /<link rel="canonical" href="https:\/\/devledger\.site\/" \/>/);
  assert.match(html, /property="og:title" content="Dev Ledger — Code Metrics"/);
  assert.match(html, /property="og:image" content="https:\/\/devledger\.site\/og\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/devledger\.site\/og\.png"/);
  assert.match(html, /name="theme-color" content="#0a0a0a"/);
});

test('social preview endpoint returns a static PNG with cache headers', () => {
  const og = src('lib/social-card.mjs');
  const user = src('api/user.mjs');
  const vercel = src('vercel.json');

  assert.match(og, /Content-Type', 'image\/png'/);
  assert.match(og, /1200x630/);
  assert.match(og, /Buffer\.from\(PNG_BASE64, 'base64'\)/);
  assert.match(og, /s-maxage=31536000/);
  assert.match(user, /action === 'social-card'/);
  assert.match(user, /sendSocialCard\(res\)/);
  assert.match(vercel, /"source": "\/og\.png"/);
  assert.match(vercel, /"destination": "\/api\/user\?action=social-card"/);
});
