/* SECURITY & PRIVACY — public trust record.
   Route: /security (canonical; /privacy redirects here). Rendered by the
   public-route layer in src/main.tsx, ABOVE the authenticated Gate — no
   session, /api/user call, or dashboard data is required. PAGES stays
   exactly overview/activity/code; this page is deliberately not in it.

   SOURCE-OF-TRUTH CONTRACT — claims here mirror real behavior, not
   marketing. Update this page whenever any of these change:
     - GitHub App permissions or subscribed webhook events
     - stored schema (migrations/*) — especially data-minimization fields
     - session/auth model (lib/auth.mjs, lib/sessions.mjs, lib/config.mjs)
     - security telemetry fields/retention (lib/security-events.mjs, 009)
     - platform analytics wiring (Vercel Web Analytics mount in src/main.tsx)
     - account/repo deletion behavior (api/user.mjs)
     - backup/retention posture (scripts/backup-*.mjs, docs/disaster-recovery.md)
   Code and migrations remain authoritative; this file carries no secrets
   and must never name env vars, project refs, hosts, or key material. */

const SECTIONS: { id: string; num: string; name: string }[] = [
  { id: 'sec-principle',   num: '00', name: 'PRINCIPLE' },
  { id: 'sec-access',      num: '01', name: 'WHAT DEV LEDGER ACCESSES' },
  { id: 'sec-stored',      num: '02', name: 'WHAT DEV LEDGER STORES' },
  { id: 'sec-not-stored',  num: '03', name: 'WHAT DEV LEDGER DOES NOT STORE' },
  { id: 'sec-github',      num: '04', name: 'GITHUB ACCESS & PERMISSIONS' },
  { id: 'sec-sessions',    num: '05', name: 'SESSIONS & AUTHENTICATION' },
  { id: 'sec-isolation',   num: '06', name: 'DATA ISOLATION' },
  { id: 'sec-controls',    num: '07', name: 'SECURITY CONTROLS' },
  { id: 'sec-your-data',   num: '08', name: 'YOUR DATA CONTROLS' },
  { id: 'sec-telemetry',   num: '09', name: 'SECURITY TELEMETRY & RETENTION' },
  { id: 'sec-recovery',    num: '10', name: 'RECOVERY' },
  { id: 'sec-boundaries',  num: '11', name: 'BOUNDARIES' },
];

const linkCls =
  'text-neutral-500 hover:text-[#d6ff3e] focus-visible:text-[#d6ff3e] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/40 transition-colors';

function Rule({ id, num, name }: { id: string; num: string; name: string }) {
  return (
    <div className="border-b border-neutral-900 pb-3 mb-6 scroll-mt-24">
      <div className="mono-tag text-[9px] text-[#d6ff3e]/80 tracking-[0.28em] mb-1.5" aria-hidden>
        {num} / TRUST RECORD
      </div>
      <h2 id={id} className="font-editorial font-light text-2xl md:text-3xl text-neutral-100 scroll-mt-24">
        {name}
      </h2>
    </div>
  );
}

function FieldList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-3 space-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="grid sm:grid-cols-[11rem_1fr] gap-1 sm:gap-4">
          <dt className="mono-tag text-[9px] tracking-[0.18em] text-[#d6ff3e]/70 pt-0.5">{k}</dt>
          <dd className="text-sm text-neutral-400 leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SecurityPrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col selection:bg-[#d6ff3e]/30 selection:text-white">
      {/* faint phosphor atmosphere — same restrained treatment as login */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 75% 45% at 50% 22%, rgba(214,255,62,0.04), transparent 70%)' }}
      />

      {/* chrome — same registration marks as the product surface */}
      <div className="relative flex items-center justify-between px-4 md:px-6 py-2.5 border-b border-neutral-900 bg-[#0e0e0e]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
          <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
          <span className="w-2 h-2 rounded-full bg-[#d6ff3e] orb-pulse" />
          <span className="mono-tag text-[9px] text-neutral-400 ml-3">dev-ledger — trust — public</span>
        </div>
        <div className="mono-tag text-[9px] text-neutral-600 hidden sm:flex items-center gap-3">
          <span>TRUST RECORD</span>
          <span className="text-[#d6ff3e]">● PUBLIC DOCUMENT</span>
        </div>
      </div>

      <div className="relative flex-1 w-full max-w-[880px] mx-auto px-5 md:px-8 py-10 md:py-14">
        {/* return control — plain navigation; resolves to the app when a
            session exists and to the login screen when it doesn't */}
        <a href="/" className={`mono-tag text-[9px] tracking-[0.22em] ${linkCls}`}>
          &lt; RETURN TO DEV LEDGER
        </a>

        {/* masthead */}
        <header className="mt-8 mb-12">
          <div className="mono-tag text-[9px] tracking-[0.28em] text-[#d6ff3e] mb-3">
            DEV LEDGER
          </div>
          <h1 className="font-editorial font-light text-[clamp(2.2rem,6vw,4.4rem)] leading-[0.95]">
            SECURITY &amp; PRIVACY
          </h1>
          <p className="font-editorial italic text-sm md:text-base text-neutral-400 mt-4 max-w-[58ch]">
            How your development data is accessed, stored, and controlled.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 mono-tag text-[8px] tracking-[0.2em] text-neutral-600">
            <span>DOCUMENT · TRUST RECORD</span>
            <span className="text-neutral-800">·</span>
            <span>CURRENT AS OF 2026-09</span>
            <span className="text-neutral-800">·</span>
            <span>NOT A CERTIFICATION OR INDEPENDENT AUDIT</span>
          </div>
        </header>

        {/* section index — anchor links, keyboard navigable */}
        <nav aria-label="Sections" className="mb-14 border border-neutral-900 bg-[#0c0c0c]/80 px-4 py-3">
          <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`mono-tag text-[9px] tracking-[0.16em] flex gap-3 py-0.5 ${linkCls}`}>
                  <span className="text-neutral-700">{s.num}</span>
                  <span>{s.name}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="space-y-14">
          {/* 00 / PRINCIPLE */}
          <section aria-labelledby="sec-principle">
            <Rule {...SECTIONS[0]} />
            <p className="text-sm md:text-[15px] text-neutral-400 leading-relaxed max-w-[62ch]">
              Dev Ledger collects the minimum GitHub-derived metadata needed to compute
              development metrics and reconstruct a longitudinal record of your work —
              commits over time, the shape of your code, and how your projects changed.
            </p>
            <p className="text-sm md:text-[15px] text-neutral-300 leading-relaxed max-w-[62ch] mt-4">
              The operating rule is simple: <span className="text-[#d6ff3e]">collect metrics, not source code.</span>
            </p>
          </section>

          {/* 01 / WHAT DEV LEDGER ACCESSES */}
          <section aria-labelledby="sec-access">
            <Rule {...SECTIONS[1]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              Through the GitHub App installation and GitHub APIs, Dev Ledger reads the
              following categories of data:
            </p>
            <FieldList rows={[
              ['ACCOUNT', 'GitHub user id, login, display name, avatar URL, and your installation relationship with the Dev Ledger app.'],
              ['REPOSITORIES', 'Repository id, owner/name, private or public status, default branch, primary language, archived and fork status, and sync state.'],
              ['LANGUAGES', 'Language names and byte counts per repository, as reported by GitHub.'],
              ['COMMITS', 'Commit SHA, author GitHub id and login, authored and committed timestamps, additions, deletions, and files changed.'],
              ['PULL REQUESTS', 'Pull request id, number, author identifiers, state, and created, closed, and merged timestamps.'],
            ]} />
            <p className="mono-tag text-[8px] tracking-[0.14em] text-neutral-600 leading-relaxed mt-4">
              READS ARE LIMITED TO REPOSITORIES YOUR INSTALLATION HAS GRANTED THE APP ON GITHUB.
            </p>
          </section>

          {/* 02 / WHAT DEV LEDGER STORES */}
          <section aria-labelledby="sec-stored">
            <Rule {...SECTIONS[2]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              The stored record is the metric set above, plus the bookkeeping needed to
              keep it accurate:
            </p>
            <FieldList rows={[
              ['IDENTITY', 'Your GitHub user id, login, display name, and avatar — used to render your account.'],
              ['INSTALLATIONS', 'Installation ids and the GitHub account they belong to — used to scope which repositories are yours.'],
              ['ANALYTICS', 'Repository metadata, language byte counts, per-commit statistics, and pull-request metadata described in section 01.'],
              ['SYNC BOOKKEEPING', 'Coverage windows, sync phase, and progress markers so ingestion can resume incrementally instead of re-reading history.'],
              ['SESSION RECORDS', 'A server-side record per active session — the revocation mechanism described in section 05.'],
              ['FEEDBACK', 'Bug reports and feature requests you submit through the diagnostic drawer — type, title, optional description, an optional verified screenshot, and automatic page/range/build context. No email address is collected.'],
              ['TELEMETRY', 'A privacy-safe subset of security events, described in section 09.'],
            ]} />
          </section>

          {/* 03 / WHAT DEV LEDGER DOES NOT STORE */}
          <section aria-labelledby="sec-not-stored">
            <Rule {...SECTIONS[3]} />
            <p className="text-sm text-neutral-300 leading-relaxed max-w-[62ch]">
              These are deliberate exclusions — the schema has no place to put them.
            </p>
            <FieldList rows={[
              ['SOURCE CODE', 'Dev Ledger does not clone or persist your repository source code. The app\u2019s read-only Contents permission is used by GitHub APIs that return commit statistics and language byte counts — the code itself is not stored.'],
              ['COMMIT MESSAGES', 'Commit messages are not stored. The message column was intentionally removed from the schema.'],
              ['PULL-REQUEST TITLES', 'Pull-request titles are not stored. The title column was intentionally removed from the schema.'],
              ['EMAIL ADDRESS', 'Dev Ledger does not request or store your GitHub email address — sign-in requests no email scope and the user record has no email field.'],
              ['ACCESS TOKENS', 'Your GitHub OAuth access token is used transiently during sign-in and never persisted. GitHub App installation tokens are minted on demand, are short-lived, and are never persisted either.'],
              ['WEBHOOK PAYLOADS', 'Raw webhook payload bodies are not stored as payload records. Selected fields can update the installation, repository, or pull-request metadata described above; the replay-deduplication record stores only the delivery id and event type.'],
            ]} />
          </section>

          {/* 04 / GITHUB ACCESS & PERMISSIONS */}
          <section aria-labelledby="sec-github">
            <Rule {...SECTIONS[4]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              Dev Ledger is a GitHub App with read-only repository permissions:
            </p>
            <FieldList rows={[
              ['CONTENTS', 'Read-only — required for commit-history and language queries.'],
              ['PULL REQUESTS', 'Read-only — required to list your pull requests.'],
              ['METADATA', 'Read-only — the minimum GitHub requires of every app.'],
              ['EVENTS', 'Subscribed webhook events: push, pull_request, installation, installation_repositories.'],
            ]} />
            <ul className="mt-4 space-y-2 text-sm text-neutral-400 leading-relaxed max-w-[62ch] list-none">
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Private repositories are reachable only where you or your organization have explicitly granted the app access on GitHub.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Repository access is managed on GitHub — you can add or remove repositories, or uninstall the app, at any time.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Dev Ledger holds no write permission to repository contents and never pushes, edits, or opens anything in your repositories.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Removing a repository on GitHub stops future ingestion for it; already-collected analytics are retained until you delete them (see section 08).</li>
            </ul>
          </section>

          {/* 05 / SESSIONS & AUTHENTICATION */}
          <section aria-labelledby="sec-sessions">
            <Rule {...SECTIONS[5]} />
            <ul className="space-y-2.5 text-sm text-neutral-400 leading-relaxed max-w-[62ch] list-none">
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Sign-in is GitHub OAuth. Your session is a sealed, tamper-evident cookie: HttpOnly, Secure over HTTPS, SameSite=Lax.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Every session also has a server-side record. Signing out revokes it immediately — a copied cookie stops working at the same moment.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Default sessions are browser-scoped <em className="not-italic text-neutral-300">plus</em> a server-enforced inactivity lease: with no Dev Ledger contact for roughly five minutes, the session expires — renewed only while a Dev Ledger page is actually open.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>&ldquo;Keep me signed in&rdquo; explicitly opts into a persistent session of approximately 30 days with no inactivity lease.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Deleting your data revokes every session at once. Sessions predating server-side records fail closed and must sign in again.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Sign-out is a POST-only, same-origin endpoint — a third-party site cannot log you out.</li>
            </ul>
          </section>

          {/* 06 / DATA ISOLATION */}
          <section aria-labelledby="sec-isolation">
            <Rule {...SECTIONS[6]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              Your browser never receives a general-purpose database credential. It talks
              only to Dev Ledger's same-origin API; the server validates your session and
              runs queries scoped to your internal user id on your behalf.
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-neutral-400 leading-relaxed max-w-[62ch] list-none">
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Every application table enforces row-level security with zero browser-facing policies — a closed second barrier behind API-level scoping.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>The browser-facing database roles (anon, authenticated) hold no privileges on application tables; the only data path is the server-side credential.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Dashboard analytics run as SECURITY INVOKER functions and views — they inherit the caller's privileges rather than bypassing them.</li>
            </ul>
          </section>

          {/* 07 / SECURITY CONTROLS */}
          <section aria-labelledby="sec-controls">
            <Rule {...SECTIONS[7]} />
            <FieldList rows={[
              ['WEB', 'Strict Content Security Policy — no unsafe-inline for scripts or styles (the single runtime stylesheet is pinned by hash); HSTS; content-type sniffing disabled; framing denied; restrictive Permissions-Policy and Referrer-Policy.'],
              ['REQUESTS', 'Same-origin enforcement on browser mutations; webhook HMAC-SHA256 signature verification with delivery-id replay deduplication; an authenticated scheduler for background sync; OAuth state validation with a freshness bound; server-side session revocation.'],
              ['DATABASE', 'Backend-only access model, row-level security, least-privilege grants, and deliberate data minimization (section 03).'],
              ['SUPPLY CHAIN', 'Dependency auditing and a lockfile; secret scanning over the worktree and full git history; pinned CI actions; test, typecheck, and build gates on every change.'],
            ]} />
          </section>

          {/* 08 / YOUR DATA CONTROLS */}
          <section aria-labelledby="sec-your-data">
            <Rule {...SECTIONS[8]} />
            <FieldList rows={[
              ['MANAGE ACCESS', 'GitHub controls which repositories the app may read — change them any time from your GitHub installation settings.'],
              ['STOP SYNCING, KEEP HISTORY', 'Per repository: future ingestion stops, and the analytics already collected remain — history stays because you chose to keep it.'],
              ['RESUME SYNCING', 'Re-enables ingestion for a retained repository.'],
              ['DISCONNECT & DELETE', 'Permanently removes the repository record and its stored commits, pull requests, language data, coverage, and repository-specific sync bookkeeping.'],
              ['DELETE MY DATA', 'Revokes every active session, then deletes your account record — cascading through installations, repositories, languages, commits, pull requests, feedback submissions, and sync state.'],
            ]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch] mt-4">
              Two honest caveats: privacy-safe security telemetry may outlive deletion under
              its retention policy (section 09), and backups follow the recovery
              retention policy (section 10) rather than deleting in place.
            </p>
          </section>

          {/* 09 / SECURITY TELEMETRY & RETENTION */}
          <section aria-labelledby="sec-telemetry">
            <Rule {...SECTIONS[9]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              Designated security events — CSRF blocks, invalid session records, webhook
              signature failures, replay attempts, sign-outs, account deletions — emit a
              fixed-field record. A designated subset is subject to a 30-day cleanup policy;
              the rest exists only as structured runtime logs.
            </p>
            <FieldList rows={[
              ['RECORDED', 'Event type, severity, route and method, status, request id, reason code, and HMAC-derived correlation hashes that can group repeated events without storing the raw actor or source identifier in the security-event record.'],
              ['SECURITY EVENT EXCLUSIONS', 'Dev Ledger\u2019s security-event records and structured security-event log lines do not include raw IP address, User-Agent, cookies, authorization headers, OAuth tokens, request bodies, or stack traces. This statement does not describe separate platform-level request or operational logs.'],
              ['RETENTION', 'Core analytics are kept while your account or a repository\u2019s history is retained. Persisted security events target a 30-day retention window via scheduled cleanup. Webhook replay-deduplication rows are pruned once older than 30 days when subsequent valid webhook traffic arrives, so actual deletion can occur later during quiet periods. Sessions expire and revoke independently. Backups carry their own recovery retention.'],
              ['PLATFORM ANALYTICS', 'This site is hosted on Vercel and loads Vercel Web Analytics — the platform\u2019s built-in, cookieless traffic measurement. Per Vercel\u2019s documentation it records page views (page URL, referrer, browser, OS, device type, and country-level location), identifies visitors by a hash derived from the incoming request that resets daily, reports only aggregated statistics, and cannot identify or re-identify an individual visitor or follow them across days or other sites. Its script and beacons are served same-origin under /_vercel/insights/ — no third-party domain is contacted. This platform measurement is separate from Dev Ledger\u2019s own records: it is not stored in the Dev Ledger database, it does not read your GitHub or dashboard data, and it is not covered by DELETE MY DATA because Dev Ledger does not hold it.'],
            ]} />
          </section>

          {/* 10 / RECOVERY */}
          <section aria-labelledby="sec-recovery">
            <Rule {...SECTIONS[10]} />
            <ul className="space-y-2.5 text-sm text-neutral-400 leading-relaxed max-w-[62ch] list-none">
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Schema changes are version-controlled migrations reviewed like code.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>Backups are allowlist-scoped logical dumps — application tables only, never platform-internal or ephemeral tables.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>A synthetic Postgres 17 restore drill runs in CI, proving the migrate → backup → restore path against fixture data.</li>
              <li className="flex gap-3"><span aria-hidden className="text-[#d6ff3e]">▸</span>The first production backup was verified on 2026-09-24 (checksum and archive contents). Encrypted off-site retention is an operational item still being configured — this page will be updated when it is active.</li>
            </ul>
          </section>

          {/* 11 / BOUNDARIES */}
          <section aria-labelledby="sec-boundaries">
            <Rule {...SECTIONS[11]} />
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[62ch]">
              This page describes Dev Ledger's current technical data-handling and security
              design. It is not a certification, an independent security audit, or a legal
              privacy policy — and it deliberately avoids absolute claims. What it states
              is what the code does today; when the code changes, this record is updated.
            </p>
          </section>
        </main>

        <div className="mt-16 pt-6 border-t border-neutral-900 flex items-center justify-between gap-4">
          <a href="/" className={`mono-tag text-[9px] tracking-[0.22em] ${linkCls}`}>
            &lt; RETURN TO DEV LEDGER
          </a>
          <span className="mono-tag text-[8px] tracking-[0.2em] text-neutral-700">END OF RECORD</span>
        </div>
      </div>
    </div>
  );
}
