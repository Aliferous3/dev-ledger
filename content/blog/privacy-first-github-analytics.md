---
slug: privacy-first-github-analytics
title: How to Track Developer Activity Without Storing Source Code
description: Developer analytics can be built from repository metadata, commit statistics, language counts, timestamps, and repository state without persisting the source code itself.
date: 2026-09-28
updated: 2026-09-28
author: Noaman Ali
tags: privacy-first analytics, GitHub App, developer analytics, GitHub privacy
ogImage: /blog/privacy-first-github-analytics.png
---

Developer analytics does not require a permanent copy of a user's source code.

Many useful historical signals can be reconstructed from metadata: repository identity, commit timestamps, additions, deletions, language byte counts, pull-request state, and synchronization history.

That creates an important architectural possibility:

**collect the measurements needed for analysis without persisting the code being measured.**

## Start with the question the product needs to answer

A privacy-conscious analytics system should begin with purpose.

If the goal is to show:

- source growth over time
- additions and deletions
- code churn
- commit activity
- active days
- repository history
- language composition
- pull-request timing
- project milestones

then full source-code storage may be unnecessary.

The system needs enough data to compute those views, not necessarily enough data to reproduce the repository.

## Metadata can carry a surprising amount of history

Useful GitHub-derived metadata can include:

- repository id and name
- owner
- default branch
- archived or fork status
- primary language
- commit SHA
- commit timestamps
- author identifiers
- additions
- deletions
- files changed
- pull-request state and timestamps
- language byte counts
- installation and synchronization state

From those fields, a system can reconstruct a large portion of the quantitative history without storing file contents.

## Source growth does not require keeping the source

To calculate [net source growth](/blog/measure-source-code-growth-over-time), you need additions and deletions across a period.

The formula is:

`net source growth = additions - deletions`

The calculation does not require retaining the lines themselves.

Similarly, [code churn](/blog/what-is-code-churn) can be computed from the same statistics:

`churn = additions + deletions`

These metrics describe source movement without requiring a searchable archive of the source text.

## Language analytics can use aggregate counts

Git hosting APIs can expose language composition as aggregate byte counts.

That is enough to answer questions such as:

- Which languages dominate a repository?
- How did language mix change?
- When did a new language appear?
- Which repositories account for most of a language?

A historical system can store those aggregate measurements rather than individual source files.

## Commit messages are optional for many analytics use cases

Commit messages can be useful for search and qualitative analysis, but they are not required for basic longitudinal metrics.

If the product focuses on:

- cadence
- growth
- churn
- activity
- milestones
- language trends

then storing commit messages may add privacy exposure without being necessary for the core measurement model.

The same reasoning can apply to pull-request titles and free-form text.

This is data minimization: do not retain a field simply because an API can provide it.

## Authentication tokens should not become analytics records

Access credentials are operational secrets, not analytical data.

A safer architecture keeps them separate from the historical metrics model.

For example:

- OAuth credentials can be used transiently during sign-in.
- Installation tokens can be short-lived and minted when needed.
- Persistent analytical tables can contain only the metadata required for the product.

This reduces the amount of sensitive material present in long-term storage.

## Read-only permissions reduce the blast radius

If an analytics application does not need to modify repositories, it should not request write access merely for convenience.

Read-only permissions establish an important boundary:

the application can inspect the authorized data needed for measurement, but it cannot push source changes, edit repository content, or create modifications on the user's behalf.

Permission minimization and data minimization complement each other.

## Repository authorization should stay explicit

A user should be able to decide which repositories an application can access through the platform's installation controls.

That matters especially for private repositories.

An analytics system should not assume that connecting an account implies unlimited access to every repository forever.

Explicit repository authorization keeps scope visible and reversible.

## Store synchronization state, not repeated raw payloads

A historical analytics system usually needs bookkeeping:

- what has already been synchronized
- which date range is complete
- where a rate-limited operation should resume
- which repositories are still pending
- when the last successful update occurred

Persisting this state can make ingestion reliable without requiring raw webhook payloads or repeated copies of source data.

The system stores what it needs to continue, not every intermediate object it has ever seen.

## Webhooks can be reduced to selected fields

Raw webhook bodies can contain much more information than an analytics product needs.

Instead of keeping the full payload indefinitely, a service can:

1. validate the webhook
2. extract the small set of fields needed to update state
3. process the event
4. retain only replay-deduplication or synchronization metadata where necessary

This limits long-term data accumulation.

## Privacy improves the threat model, but does not remove it

Not storing source code does not make a service invulnerable.

A production system still needs protections around:

- sessions
- authentication
- database isolation
- secrets
- webhook verification
- same-origin mutation controls
- dependency security
- backups
- recovery
- telemetry
- deletion

Data minimization reduces what can be exposed. It does not replace security engineering.

## Analytics still needs clear boundaries

Even a metadata-only system should communicate what it does and does not collect.

Users should be able to distinguish:

- repository metadata
- code-change statistics
- account identity
- synchronization records
- application telemetry
- source code
- messages
- email addresses
- credentials

Specific claims are more useful than vague statements such as "we value privacy."

## Deletion should remove the derived record too

If a user asks to delete their data, the system should consider more than the account row.

Derived data can include:

- repositories
- commit statistics
- language history
- pull-request metadata
- sync state
- sessions
- feedback
- telemetry associated with the user

A privacy-first architecture treats these as part of the user's record and designs deletion accordingly.

## The trade-off: less stored data means some features are impossible

Data minimization creates deliberate limitations.

If you do not store source code, you cannot later offer arbitrary full-text code search from your own database.

If you do not store commit messages, you cannot build historical semantic analysis over those messages without re-fetching them.

That is not necessarily a flaw.

A privacy-conscious product can choose a narrower set of capabilities in exchange for a smaller data footprint.

## Dev Ledger's approach

Dev Ledger is designed around the principle **collect metrics, not source code**.

Its public [Security & Privacy](https://devledger.site/security) record describes the current boundaries in detail.

The application uses read-only GitHub access for the repositories a user authorizes and persists GitHub-derived metadata needed for longitudinal analytics.

It does not persist repository source code, commit messages, pull-request titles, GitHub email addresses, OAuth access tokens, installation tokens, or raw webhook payload bodies.

That architecture is what allows the product to show development history while keeping the stored record narrower than the repositories themselves.

## The broader lesson

Privacy-first analytics is largely an exercise in asking a disciplined question:

**What is the minimum durable data required to deliver the promised feature?**

Once that is clear, everything else becomes optional rather than automatic.

For developer analytics, that can be the difference between storing a user's codebase and storing only the measurements needed to understand how it changed.
