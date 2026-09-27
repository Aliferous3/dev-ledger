import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('privacy policy is a standalone public legal document', () => {
  const privacy = src('src/legal/PrivacyPolicyPage.tsx');
  assert.match(privacy, /PRIVACY POLICY/);
  assert.match(privacy, /INFORMATION WE PROCESS/);
  assert.match(privacy, /INFORMATION WE DELIBERATELY DO NOT STORE/);
  assert.match(privacy, /LEGAL BASES WHERE REQUIRED/);
  assert.match(privacy, /SERVICE PROVIDERS & DISCLOSURES/);
  assert.match(privacy, /RETENTION & DELETION/);
  assert.match(privacy, /INTERNATIONAL PROCESSING/);
  assert.match(privacy, /YOUR RIGHTS & CHOICES/);
  assert.match(privacy, /GitHub/);
  assert.match(privacy, /Vercel/);
  assert.match(privacy, /Supabase/);
  assert.match(privacy, /PostHog/);
  assert.match(privacy, /does not sell personal data/i);
  assert.match(privacy, /does not persist repository source code/i);
  assert.ok(!privacy.includes('fetch('), 'legal page must remain static');
});

test('terms cover assent, authorized use, service limits, deletion and liability boundaries', () => {
  const terms = src('src/legal/TermsOfServicePage.tsx');
  assert.match(terms, /TERMS OF SERVICE/);
  assert.match(terms, /By selecting “Continue with GitHub”/);
  assert.match(terms, /GITHUB ACCESS/);
  assert.match(terms, /ACCEPTABLE USE/);
  assert.match(terms, /METRICS & OUTPUT LIMITATIONS/);
  assert.match(terms, /AVAILABILITY, CHANGES & TERMINATION/);
  assert.match(terms, /DISCLAIMERS/);
  assert.match(terms, /LIMITATION OF LIABILITY/);
  assert.match(terms, /mandatory rights/i);
  assert.ok(!terms.includes('fetch('), 'legal page must remain static');
});

test('login uses affirmative click-through notice with both legal documents', () => {
  const login = src('src/ledger/LoginScreen.tsx');
  assert.match(login, /By continuing with GitHub, you agree to the/);
  assert.match(login, /Terms of Service/);
  assert.match(login, /and acknowledge the/);
  assert.match(login, /Privacy Policy/);
  assert.match(login, /href="\/terms"/);
  assert.match(login, /href="\/privacy"/);
});

test('legal pages do not claim certifications or absolute compliance', () => {
  const legal = [
    src('src/legal/PrivacyPolicyPage.tsx'),
    src('src/legal/TermsOfServicePage.tsx'),
  ].join('\n');
  for (const re of [
    /SOC[\s-]?2/i,
    /ISO[\s-]?27001/i,
    /\bGDPR compliant\b/i,
    /\bCCPA compliant\b/i,
    /fully secure/i,
    /unhackable/i,
    /guaranteed security/i,
  ]) {
    assert.ok(!re.test(legal), `legal pages must not overclaim: ${re}`);
  }
});


test('legal pages mirror the security trust-record visual grammar', () => {
  const shell = src('src/legal/LegalPageShell.tsx');
  const privacy = src('src/legal/PrivacyPolicyPage.tsx');
  const terms = src('src/legal/TermsOfServicePage.tsx');

  assert.match(shell, /max-w-\[880px\]/);
  assert.match(shell, /aria-label="Sections"/);
  assert.match(shell, /grid sm:grid-cols-2 gap-x-8 gap-y-1\.5/);
  assert.match(shell, /00|LEGAL RECORD/);
  assert.match(shell, /END OF RECORD/);

  assert.match(privacy, /const SECTIONS = \[/);
  assert.match(privacy, /sections=\{SECTIONS\.map/);
  assert.match(terms, /const SECTIONS = \[/);
  assert.match(terms, /sections=\{SECTIONS\.map/);
});
