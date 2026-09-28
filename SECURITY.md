# Security Policy

Security reports are handled separately from ordinary bugs.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository. Include:

- a concise description of the issue;
- affected route, component, or feature;
- reproduction steps;
- realistic impact;
- any proof-of-concept material needed to validate the report; and
- suggested remediation, if known.

Do not include real user data, production credentials, private repository contents, or destructive payloads beyond what is necessary to demonstrate the issue.

If private vulnerability reporting is temporarily unavailable, do not publish the details publicly. Use the private contact path exposed by the project/operator until a private GitHub report can be opened.

## Scope

High-value areas include:

- authentication and session handling;
- cross-user / tenant isolation;
- GitHub App permission or installation-boundary bypasses;
- webhook signature or replay handling;
- destructive repository/account actions;
- Supabase authorization or RLS bypasses;
- secret or token exposure;
- CSP / script-injection issues;
- analytics leakage of repository or identity data; and
- production artifact leakage of private fixtures or credentials.

## Supported version

The hosted service and the latest code on `main` are the supported version.

| Version | Supported |
| --- | --- |
| latest `main` / production | Yes |
| older commits or deployments | No |

## What to expect

A report will be triaged for reproducibility, impact, affected data, and whether emergency credential/session rotation is required. Fixes should include regression coverage where practical.

Dev Ledger does not claim any external security certification or independent audit.
