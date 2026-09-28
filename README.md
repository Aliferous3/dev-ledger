<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/masthead-dark.svg"><img alt="DEV LEDGER. Your GitHub history, made legible. Open source · Privacy-conscious · Read-only. v1.3.0 · AGPL-3.0-only" src="assets/readme/session/masthead-light.svg" width="100%"></picture></p>

<p align="center"><a href="https://devledger.site"><code>Live App</code></a> · <a href="docs/architecture.md"><code>Documentation</code></a> · <a href="https://devledger.site/security"><code>Security</code></a> · <a href="LICENSE"><code>License</code></a></p>

<p align="center"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3GpOWm9epe88c9na7udIEi8dsIo/d3b6f6b5-3c09-4dea-815a-05a655ed10b1.webp" alt="Dev Ledger product demo" width="100%"></p>

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h01-dark.svg"><img alt="What Dev Ledger measures" src="assets/readme/session/h01-light.svg"></picture></h2>

Dev Ledger connects through a GitHub App and builds a read-only analytical record from repositories the user explicitly authorizes.

| `MEASURE` | `ACTIVITY` | `CODE` |
| --- | --- | --- |
| Net source growth | Active days | Language composition |
| Additions & deletions | Streaks & extremes | Repository history |
| Churn | Circadian patterns | Project evolution |
| Commits | Rhythm & milestones | Longitudinal change |

| `SHARE` | `HISTORY` | `SYNC` |
| --- | --- | --- |
| Range-aware visual records | Months and years of development | GitHub webhooks |
| Compact exports | Change over time | Resumable history coverage |
| Selected-range context | Longitudinal patterns | Rate-limit-aware continuation |

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h02-dark.svg"><img alt="Privacy by design" src="assets/readme/session/h02-light.svg"></picture></h2>

> [!IMPORTANT]
> **Dev Ledger measures development activity without indexing repository source code.**

Dev Ledger is intentionally narrower than a source-code indexing product.

| Dev Ledger uses | Dev Ledger does not persist |
| --- | --- |
| Repository metadata needed for product metrics | Repository source code |
| Git-derived activity data | Commit messages |
| Language statistics | Pull-request titles |
| Computed development history | GitHub email addresses |
| Synchronization state | GitHub OAuth access tokens |
|  | GitHub App installation tokens |
|  | Raw webhook payload bodies |

The product stores only the GitHub-derived metadata needed to compute its metrics and maintain synchronization. Repository permissions are read-only.

The public [Security & Privacy Trust Record](https://devledger.site/security) documents the current implementation and security boundaries in detail.

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h03-dark.svg"><img alt="Architecture" src="assets/readme/session/h03-light.svg"></picture></h2>

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#0e0f0e','primaryTextColor':'#e8e6e0','primaryBorderColor':'#4a4945','lineColor':'#8a877f','edgeLabelBackground':'#131413','fontFamily':'SFMono-Regular, Menlo, monospace'}}}%%
flowchart LR
  B[Browser] -->|GitHub OAuth| G[GitHub]
  B -->|same-origin HTTPS| D[Dev Ledger / Vercel]
  G -->|GitHub App API + signed webhooks| D
  D -->|server-side only| S[(Supabase Postgres)]
  D -->|allowlisted product events| P[PostHog EU]
  B -->|cookieless traffic measurement| A[Vercel Web Analytics]
```

The frontend is React + Vite. API routes run as Vercel Functions. GitHub App ingestion writes normalized metadata to Supabase Postgres. The browser never receives a database service credential.

[Read the architecture documentation →](docs/architecture.md)

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h04-dark.svg"><img alt="Technology" src="assets/readme/session/h04-light.svg"></picture></h2>

<table>
<tr><td><code>Frontend</code></td><td><code>React 19</code> · <code>TypeScript</code> · <code>Vite 8</code></td></tr>
<tr><td><code>Interface</code></td><td><code>Tailwind CSS 4</code> · <code>Framer Motion</code></td></tr>
<tr><td><code>Identity</code></td><td><code>GitHub OAuth</code> · <code>GitHub App</code></td></tr>
<tr><td><code>Compute</code></td><td><code>Vercel Functions</code></td></tr>
<tr><td><code>Data</code></td><td><code>Supabase Postgres</code></td></tr>
<tr><td><code>Product analytics</code></td><td><code>PostHog</code> · <code>custom-event-only</code></td></tr>
<tr><td><code>Traffic analytics</code></td><td><code>Vercel Web Analytics</code></td></tr>
<tr><td><code>CI</code></td><td><code>GitHub Actions</code></td></tr>
<tr><td><code>Security checks</code></td><td><code>Typecheck</code> · <code>tests</code> · <code>npm audit</code> · <code>gitleaks</code> · <code>artifact scan</code> · <code>recovery drill</code></td></tr>
</table>

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h05-dark.svg"><img alt="Quick start" src="assets/readme/session/h05-light.svg"></picture></h2>

**Requirements:** <kbd>Node.js 24</kbd> · <kbd>npm</kbd> · <kbd>Git</kbd>

```sh
git clone https://github.com/Aliferous3/dev-ledger.git
cd dev-ledger
npm ci
npm run dev
```

Plain Vite runs the UI with synthetic development fixtures. Production builds replace the fixture barrel with an inert stub, so fixture telemetry does not ship to users.

<details>
<summary><strong>Run the full GitHub + Supabase stack</strong></summary>

<br>

Install the Vercel CLI, copy the environment template, and populate your own GitHub App and Supabase values:

```sh
cp .env.example .env.local
vercel dev
```

Never commit `.env.local`, private keys, database dumps, or provider credentials.

</details>

<details>
<summary><strong>Run the verification suite</strong></summary>

<br>

Run the same core checks used by CI:

```sh
npm run build
npm run typecheck
npm test
npm audit --audit-level=moderate
```

The GitHub Actions security gate also scans git history with gitleaks and runs a synthetic Postgres 17 migrate → backup → restore verification.

</details>

<details>
<summary><strong>Database operations</strong></summary>

<br>

Migrations live in [`migrations/`](migrations/) and are the schema source of truth.

Postgres 17 or Docker is required only for local recovery-drill work.

```sh
npm run db:migrate
npm run db:backup
npm run db:drill
```

The recovery drill refuses non-local database targets. Production recovery remains an operator-controlled procedure documented in [docs/disaster-recovery.md](docs/disaster-recovery.md).

</details>

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h06-dark.svg"><img alt="Security" src="assets/readme/session/h06-light.svg"></picture></h2>

> [!CAUTION]
> **Do not open a public issue for a vulnerability.** Follow [SECURITY.md](SECURITY.md) for private reporting.

The repository CI is intentionally fail-closed around common release risks: dependency audit, secret scanning, browser/server environment separation, built-artifact inspection, strict typechecking, and a synthetic recovery drill.

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h07-dark.svg"><img alt="Repository guides" src="assets/readme/session/h07-light.svg"></picture></h2>

| CONTRIBUTE | SECURITY | OPERATIONS | PROJECT |
| --- | --- | --- | --- |
| [Contributing](CONTRIBUTING.md) | [Security policy](SECURITY.md) | [Architecture](docs/architecture.md) | [Changelog](CHANGELOG.md) |
| [Code of conduct](CODE_OF_CONDUCT.md) | [Support](SUPPORT.md) | [Disaster recovery](docs/disaster-recovery.md) | [Trademark policy](TRADEMARKS.md) |
| [Contributor agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md) | [Security & Privacy](https://devledger.site/security) | [Secret rotation](docs/secret-rotation.md) | [Privacy Policy](https://devledger.site/privacy) |

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h08-dark.svg"><img alt="Status" src="assets/readme/session/h08-light.svg"></picture></h2>

Current application version: **v1.3.0**

Dev Ledger is under active development. Metrics are derived from available GitHub history and can be affected by repository deletion, force-pushes, attribution gaps, API limits, and disconnected repositories.

<h2><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/session/h09-dark.svg"><img alt="License" src="assets/readme/session/h09-light.svg"></picture></h2>

Dev Ledger is open source under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). See [LICENSE](LICENSE).

The AGPL permits use, modification, redistribution, and commercial use subject to its terms, including source-availability obligations for qualifying modified network deployments. The Dev Ledger name, logo, and distinctive branding are addressed separately in [TRADEMARKS.md](TRADEMARKS.md).

Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md) and the [Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md).

---

<p align="center"><strong>Dev Ledger</strong> · Your GitHub history, made legible.</p>
<p align="center"><a href="https://devledger.site"><code>Live App</code></a> · <a href="https://devledger.site/privacy"><code>Privacy Policy</code></a> · <a href="https://devledger.site/terms"><code>Terms of Service</code></a></p>
