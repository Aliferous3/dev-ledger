---
slug: measure-source-code-growth-over-time
title: How to Measure Source Code Growth Over Time
description: Learn how to calculate net source growth from additions and deletions, choose meaningful time windows, and interpret codebase growth without equating bigger with better.
date: 2026-09-28
updated: 2026-09-28
author: Noaman Ali
tags: source code growth, GitHub analytics, code metrics, repository analytics
ogImage: /blog/measure-source-code-growth-over-time.png
---

Source code growth sounds like a simple question: how much larger did the codebase become?

In practice, the useful version of that question is more precise:

**How did the amount of tracked source change during a defined period, and what explains that change?**

That distinction matters because raw repository size can hide rewriting, deletion, migration, generated files, and long periods of inactivity.

## Start with additions and deletions

The simplest period-based measure is:

`net source growth = additions - deletions`

If a repository adds 12,000 lines and deletes 7,500 during a quarter:

`12,000 - 7,500 = 4,500 lines`

That means the tracked codebase ended the period with 4,500 more lines than those changes removed.

It does **not** mean the project became 4,500 lines "better." It only describes the direction and magnitude of source change.

## Why net growth is more useful than additions alone

Looking only at additions can produce a distorted picture.

Suppose a project adds 15,000 lines. That sounds like substantial expansion.

But if the same period also deletes 14,000 lines, the codebase only grows by 1,000 net lines.

The period was highly active, but mostly involved replacement rather than expansion.

This is why additions, deletions, net growth, and [code churn](/blog/what-is-code-churn) belong together.

## Pick a time window before reading the number

A growth figure without a date range is difficult to interpret.

Useful ranges depend on the question:

- **7 days** for a release sprint or short burst
- **30 days** for recent development
- **90 days** for a broader project phase
- **year to date** for current-year direction
- **one year** for longer-term evolution
- **all time** for historical scale

The same repository may look completely different across those ranges.

A fast-growing month can sit inside a flat year. A shrinking quarter can be part of a long-term expansion.

## Compare equal periods

If you want to understand whether growth is accelerating or slowing, compare like with like.

For example:

- last 30 days vs previous 30 days
- current quarter vs previous quarter
- current year vs previous year

This reduces the risk of drawing conclusions from windows of very different lengths.

It also makes the comparison easier to communicate.

## Track the direction, not only the magnitude

Positive growth means additions exceeded deletions.

Negative growth means deletions exceeded additions.

Flat growth means the two were roughly balanced.

All three can describe healthy engineering activity.

Negative growth may result from:

- removing obsolete code
- simplifying a system
- deleting generated artifacts
- consolidating duplicated functionality
- migrating functionality to another repository
- replacing a larger implementation with a smaller one

A shrinking codebase can be a deliberate outcome.

## Separate growth from churn

Growth answers:

**What was the net change?**

Churn answers:

**How much code moved?**

Consider two periods:

- Period A: +5,000 additions, -500 deletions
- Period B: +10,000 additions, -5,500 deletions

Both produce +4,500 net growth.

But Period A has 5,500 lines of churn, while Period B has 15,500.

That difference helps distinguish straightforward expansion from a much more intensive rewrite.

## Repository size changes the meaning of a growth number

Adding 8,000 lines to a 20,000-line project is a large proportional change.

Adding the same 8,000 lines to a multimillion-line monorepo may barely move the overall size.

For this reason, absolute net growth is useful, but relative context can help:

`growth rate = net source growth / starting source size`

If reliable starting-size data is available, the ratio can show whether the repository changed slightly or substantially relative to its existing scale.

Still, ratios should not be overinterpreted. A small repository can show extreme percentages from modest changes.

## Look at repository-level contributions to total growth

A developer's overall GitHub history may contain many repositories.

If total net source growth rises sharply, ask which repositories drove it.

One project might account for nearly all of the increase. Another might be shrinking at the same time.

Breaking growth down by repository reveals whether the trend is broad or concentrated.

It can also show transitions: one project winding down while another becomes the center of development.

## Language history adds another layer

Total source growth does not tell you what kind of code changed.

A historical language view can show whether growth came from:

- more TypeScript in a web application
- a new Python service
- infrastructure configuration
- mobile code
- a migration from one language to another
- a new repository with a different stack

This can make a growth curve much easier to explain.

If a project grows by 20,000 lines at the same time a new language appears, the two events may be related.

## Generated files can create artificial-looking jumps

Tracked generated output can dominate line counts.

Examples include:

- generated clients
- bundled assets
- schema output
- snapshots
- lockfiles
- compiled artifacts
- machine-generated documentation

A single regeneration can produce a large spike in additions and deletions.

If a chart moves unexpectedly, inspect the underlying repository activity before treating the jump as meaningful source expansion.

## Repository history can be rewritten

Git history can change through:

- rebases
- squash merges
- force pushes
- branch replacement
- repository imports
- history cleanup

Metrics based on Git reflect the history currently available.

That means a historical growth series should be understood as a reconstruction from repository data, not an immutable accounting system.

## Avoid treating larger codebases as inherently better

More code can mean:

- more features
- more platforms
- more complexity
- more duplication
- more generated output
- a new architecture

Less code can mean:

- deletion of dead code
- simplification
- consolidation
- migration
- loss of functionality

The number does not know which one happened.

Source growth is best used to identify *where* and *when* major change occurred.

## A simple review process

For each period:

1. Record additions.
2. Record deletions.
3. Calculate net growth.
4. Calculate churn.
5. Identify the repositories responsible for most of the change.
6. Check language composition.
7. Compare with the previous equal-length period.
8. Note milestones that explain unusually large movements.

That process creates a historical narrative rather than a single score.

## Growth belongs inside a longitudinal view

A codebase is rarely interesting because it became bigger.

What matters is how its shape changed over time: expansion, replacement, contraction, migration, dormancy, and revival.

That is why Dev Ledger treats net source growth as one component of a larger developer history rather than as a performance target.

For a broader framework, read [How to Analyze Your GitHub Development History](/blog/analyze-github-development-history).
