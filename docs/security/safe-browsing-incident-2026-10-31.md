# Safe Browsing incident: deceptive-pages classification (2026-10-31)

**Status:** Investigation; review not submitted. **Do not declare the
site clean based solely on the repository checks below.** Google Search
Console currently displays "Deceptive pages" with "Sample URLs: N/A".
Chrome displays a red "Dangerous" warning for devledger.site.

## Confirmed production provenance

- First-party project: Vercel `dev-ledger`, domain `devledger.site`
  (domain verified), production deployment
  `dpl_CCyLRX7Cypc32T566eKVJj1jVQyw`.
- Deployed GitHub revision: `c056bb0e1dbe8dc99b36a96e1183b607d68f57fa`;
  matches main when the incident was inspected.
- Publishing-layer project: `dev-ledger-site`, source revision
  `5c130ce86d35c329566c312fee305f5622dd904b`.
- The main app rewrites blog/tools/answers/guides/glossary/comparisons
  to `dev-ledger-site.vercel.app`; these must be audited as part of the
  effective public site, not treated as external non-responsibility.
- The main app rewrites `/rly/` analytics events to
  `eu.i.posthog.com`. Web analytics and Google Analytics are enabled
  only as documented; the app's visible login uses GitHub OAuth.
- A previous Google security review was approved on 2026-09-29. This
  later classification must be independently reviewed; prior approval
  is not evidence that the current warning is mistaken.

## Completed source-level checks

1. Inspected the login component and OAuth entry point: the app does
   not display a GitHub-password field. It explicitly says users are
   authenticated on github.com and links to its privacy and security
   documentation. OAuth authorizes at GitHub's own endpoint with a
   session-bound state value.
2. Inspected the app's Vercel routes, headers, and HTML entry points.
   No unexplained external rewrite targets were identified. The CSP
   restricts script origins, forms, embedding, and object execution.
3. Inspected the private publishing-layer generator and its rewrites.
   The static rendering toolkit HTML-escapes content, and the
   publishing layer serves static editorial pages rather than a second
   credential-collection flow.
4. Examined all **37 Markdown content files and five SVG assets** in
   the publishing repository: no outbound `https://` links or script
   injection tokens were found in those source files. This is a
   source review, not a network crawler or rendered-site assessment.
5. Inspected Vercel and GitHub metadata: the expected Vercel domain and
   GitHub production commit were confirmed; a malicious deployment was
   not identified from the available deployment history.
6. Added `test/public-trust-boundaries.test.mjs` to prevent silent
   changes to critical first-party OAuth, routing, remote scripts, and
   security header invariants.

**Live-fetch limitation:** Attempts to retrieve the production HTML via
public web inspection failed; a separate read-only network request
could not resolve the public domain from the audit environment.
Neither result proves the site was offline or clean; Google URL
Inspection is the remaining first-party source for rendered HTML.

**Not established:** which URL or signal triggered Google's verdict,
whether all delivered runtime HTML/JS has been dynamically examined,
whether unknown Google Search Console property owners exist, and whether
there are other unauthorized resources or redirect paths. Source-level
checks cannot independently rule out compromise or a classifier error.

## Separate defect: OAuth token exchange

At 2026-10-31T21:12:44Z and 2026-10-31T21:23:38Z the production
`/api/auth/callback` function logged GitHub's
`bad_verification_code` response. This prevents web and desktop login.
It is **not evidence of phishing** and is not yet established as a
cause of the Safe Browsing classification. Resolve separately by
reconciling GitHub App callback settings and the deployed APP_URL/client
configuration without exposing secrets. Do not weaken OAuth state
validation or retry the same spent authorization code.

## Manual verification gates before requesting a review

- [x] In Search Console, inspect **Settings > Users and permissions**.
      Project owner confirmed on 2026-10-31 that there are no
      unexpected owners in Search Console; independent audit of
      Google verification tokens outside Search Console remains separate.
- [ ] Inspect the Security Issues report and affected-page details.
      Search Console currently has no samples; record any that appear.
- [ ] Visually inspect the live **desktop and mobile** homepage,
      login flow, all legal pages, blog, tools, answers, guides,
      glossary, and comparisons. Do not override Chrome's Safe
      Browsing warning to conduct this on a normal user machine.
      Use Search Console's URL Inspection / crawled HTML and/or a
      separate, isolated investigation environment.
- [ ] Examine served scripts, embedded frames, redirects, and links
      for unreviewed external hosts. Compare production page output
      to known clean build artifacts. Review new or unusual publicly
      accessible paths, file uploads, and executable downloads.
- [ ] Verify user-facing GitHub sign-in is transparently branded and
      does not collect credentials locally or mimic GitHub's form.
- [ ] Verify no unfamiliar Vercel deployers, domains, environment
      changes, GitHub collaborators, OAuth apps, or project access.
      Rotate/revoke credentials **only if** evidence requires it;
      never disclose them in issue comments or logs.
- [ ] Review all test/quality gates and ensure any fixes are deployed
      and tested at the canonical production domain.

## Google review path (only after the above)

Official guidance:
https://developers.google.com/search/docs/monitor-debug/security/social-engineering

Google explicitly allows a security review when no sample URLs are
provided and the owner has examined the site and is confident there
is no social-engineering content. Request via Search Console >
Security issues > Request review. Describe **only the checks actually
performed** and any remedial changes actually deployed. Do not claim
a false positive as established unless the evidence warrants it.

**Draft explanation to edit after the manual checks:**

> We reviewed the reported "Deceptive pages" classification for
> https://devledger.site. Search Console did not provide example URLs.
> Dev Ledger is an open-source GitHub analytics application. Its login
> uses GitHub OAuth and sends users to github.com for authorization;
> the application does not ask for users' GitHub passwords. We examined
> the published code, public page generation, application routes and
> allowed third-party resources for unexpected credential collection,
> deceptive redirects, embedded executable scripts, and unwanted
> downloads. [Add verified production checks and exact fixes here.]
> We request a new Safe Browsing assessment of the current production
> site. The code is publicly available at
> https://github.com/Aliferous3/dev-ledger.

Never substitute an unverified assertion of "100% secure" for this
evidence-based review. If Google's review returns new sample URLs,
investigate those directly and repeat the verification process.
