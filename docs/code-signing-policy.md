# Code signing policy

This policy applies to official Dev Ledger desktop binaries distributed from
the public `Aliferous3/dev-ledger` repository.

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
and non-canonical artifact names.

## Windows

Windows release signing uses SignPath Foundation Open Source Code Signing when
the project is approved for that service.

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
