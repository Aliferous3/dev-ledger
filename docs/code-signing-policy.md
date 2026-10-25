# Code signing policy

This policy applies to official Dev Ledger desktop binaries distributed from
the public `Aliferous3/dev-ledger` repository.

> **Signing status (October 2026):** SignPath Foundation signing is **planned,
> not approved or active**. The existing v1.4.1 desktop GitHub Release remains
> an **unpublished draft** containing unsigned Windows and macOS artifacts.
> Do not interpret this policy or its attribution as proof that any release
> has already been signed, notarized, or approved.

**Free code signing provided by SignPath.io, certificate by SignPath Foundation**
— this is the required attribution for the *proposed* Windows signing arrangement,
subject to eligibility review and SignPath Foundation approval.

## Team roles and approval

The public source repository is owned by
[Aliferous3](https://github.com/Aliferous3). Currently designated roles:

| Role | Responsible member | Responsibility |
| --- | --- | --- |
| Authors / committers | [Aliferous3](https://github.com/Aliferous3) | Maintains and authorizes code changes |
| Reviewer | [Aliferous3](https://github.com/Aliferous3) | Reviews external contributions and proposed release changes |
| Release-signing approver (proposed) | [Aliferous3](https://github.com/Aliferous3) | Reviews each tagged release and manually approves each SignPath signing request after account approval and role provisioning |

These roles document responsibilities, not an existing SignPath membership.
All human team members with GitHub or SignPath signing responsibilities must
enable multi-factor authentication in the relevant accounts before signing.
The reviewer must review incoming outside contributions; CI checks and
automated agent output are not a substitute for a maintainer's review.
Every release-signing request requires an explicit human approval.

## Privacy, network access and installation

See the public [Privacy Policy](https://devledger.site/privacy) and
[Security & Privacy Trust Record](https://devledger.site/security).
The desktop app connects to `https://devledger.site` to authenticate users
and retrieve the GitHub-derived metadata they authorize. Authentication opens
GitHub in the user's system browser; GitHub's own privacy terms apply to that
interaction. The hosted Dev Ledger service relies on Vercel and Supabase
for application hosting and data processing, as detailed in the public
privacy documentation. GitHub avatars may also be displayed.

The **desktop build itself** does not enable the web application's
PostHog, Google Analytics, Vercel Web Analytics or Speed Insights clients.
The Windows package uses Microsoft's WebView2 runtime; installation may
install or bootstrap a Microsoft runtime where absent. The installer must
make any such system change apparent to users. Installation registers the
`dev-ledger://` custom URI scheme. Both Windows installer formats must
support normal uninstall flows; absence of an operational uninstaller is
a release blocker.

We do not claim that Dev Ledger is offline-only or never sends data over the
network. Users initiate GitHub authorization; account and repository-data
handling is governed by the public privacy policy. Any future unexpected
telemetry or network transfer must be documented, disclosed at installation,
and, where required by SignPath, made optional before signing.


## Scope

Official signed binaries must be built from Dev Ledger source and release
configuration in this repository. Dev Ledger does not use its signing process
to sign unrelated projects, third-party proprietary binaries, forks maintained
by other teams, or artifacts produced outside the documented release pipeline.

## Release origin

Desktop release candidates are produced by the repository's GitHub Actions
desktop workflow on GitHub-hosted runners from an explicit `v*` tag. The
workflow is gated by the same build, typecheck, test and dependency-audit
checks used for normal CI.

The repository is the source of truth for:

- application source;
- Tauri configuration;
- dependency lockfiles;
- release-asset naming;
- package-manager manifests; and
- the CI workflow that builds and submits release artifacts for signing.

Signing credentials and private signing keys are never stored in the
repository.

## Product metadata

Signed Dev Ledger binaries must carry release metadata consistent with the
tagged source:

- Product name: **Dev Ledger**
- Application ID: **`site.devledger.desktop`**
- Executable/package name: **`dev-ledger`**
- Product version: the exact release version synchronized from
  `package.json`

The release workflow and tests reject stale or inconsistent release versions
and non-canonical artifact names. SignPath artifact configurations must also
restrict file metadata: all signed project binaries identify product name
**Dev Ledger** and agree on the same version for each tagged release.
Third-party upstream binaries must retain their own publisher identity and
must not be signed with the Dev Ledger signing configuration.

## Windows

Windows release signing is **not active**. If the application is accepted,
Windows release signing will use SignPath Foundation Open Source Code Signing.

Windows signing uses two independently verified SignPath requests: first the standalone `dev-ledger.exe`, then the canonical NSIS and MSI release packages. NSIS cannot be assumed to support nested deep-signing. Tauri bundles the signed executable using `--no-binary-patching`, so installers contain the previously signed binary. Each signing request submits its exact GitHub Actions artifact for origin verification against this repository and workflow.

The CI release path rejects the signed result unless:

- the NSIS installer has a valid Authenticode signature;
- the MSI has a valid Authenticode signature;
- the application executable installed by the NSIS package has a valid
  Authenticode signature; and
- the application executable extracted from the MSI has a valid Authenticode
  signature.

SignPath Foundation controls the public signing certificate and signing-policy
constraints for its sponsored open-source service.

## macOS

macOS release artifacts must be signed with an Apple **Developer ID
Application** identity associated with the maintainer's Apple Developer
account and notarized by Apple.

The release workflow requires successful code-signature verification,
Gatekeeper assessment and validation of the stapled notarization ticket before
macOS artifacts can reach a draft release.

## Linux

The current Linux AppImage and Debian packages do not use a platform signing
identity. Their integrity is published through the release
`SHA256SUMS.txt` file. Any future Linux package-signing mechanism must be
documented here before it is described as an official signing guarantee.

## Release publication

Successful signing does not automatically publish a release. GitHub Releases
are created as drafts. Before publication, the maintainer verifies the
platform build results, signatures/notarization state, final checksums and
package-manager metadata.

Signing changes file hashes. WinGet, Homebrew and other hash-pinned
distribution metadata must therefore be generated or updated from the final
signed release artifacts, never from pre-signing candidates.

## Security incidents

If a signing credential, signing policy, build pipeline or release artifact is
suspected to be compromised:

1. stop publication and package-manager submission;
2. revoke or disable affected signing credentials/policies where applicable;
3. remove or mark affected release artifacts;
4. investigate the source/build/signing chain; and
5. publish corrected artifacts only from a new reviewed release.

Security issues should be reported through the private process in
[SECURITY.md](../SECURITY.md), not through a public vulnerability issue.
