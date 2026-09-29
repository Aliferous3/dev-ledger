---
slug: analyze-programming-language-usage-github
title: How to Analyze Programming Language Usage Across GitHub Repositories
description: Learn how to read language composition across repositories, distinguish snapshots from trends, and use language history to understand how a developer's stack evolves over time.
date: 2026-09-29
updated: 2026-09-29
author: Noaman Ali
tags: GitHub languages, GitHub analytics, developer analytics, programming languages
ogImage: /og/dev-ledger.png
---

A programming-language breakdown looks simple: one repository is mostly TypeScript, another is mostly Python, another has a mixture of CSS, HTML, and JavaScript.

The useful question is not only **what languages are present?**

It is:

**How has the language composition of the work changed over time, and which repositories caused that change?**

That turns a static pie chart into a record of technical evolution.

## A language snapshot is only the current state

Most repository language views answer a present-tense question.

They tell you which languages account for the current tracked byte counts of a repository.

That is useful for orientation, but it does not explain the path that produced the current state.

A repository that is 80% TypeScript today may have started as JavaScript.

A developer whose profile currently looks dominated by Python may have spent the previous year mostly working in another stack.

A snapshot hides those transitions.

## Separate repository-level and account-level language views

Language analysis becomes much clearer when you distinguish two levels.

### Repository level

This answers:

- What languages make up this project?
- Did the dominant language change?
- Did a migration introduce a new language?
- Did one language shrink while another expanded?

### Account level

This answers:

- Which languages dominate across all authorized repositories?
- Which languages are becoming more prominent?
- Which repositories are responsible for those changes?
- Is the overall mix broadening or concentrating?

The two views are related, but they are not interchangeable.

A single large repository can dominate an account-level language total even when many smaller repositories use something else.

## Use historical snapshots, not only the current breakdown

If you store or reconstruct language measurements over time, you can see trajectory.

For example:

- January: JavaScript 72%, TypeScript 18%, CSS 10%
- April: JavaScript 45%, TypeScript 47%, CSS 8%
- July: JavaScript 12%, TypeScript 80%, CSS 8%

That sequence tells a much richer story than the final July snapshot.

It strongly suggests a migration or replacement process.

Language history can therefore act as a structural signal.

## Look for inflection points

The most interesting part of a language chart is often the moment when its shape changes.

Examples include:

- a new language appears suddenly
- the dominant language begins to decline
- one language overtakes another
- a previously minor language becomes significant
- the overall mix becomes more diverse
- one language disappears entirely

These moments often align with project milestones.

If a new backend service launches in Python, a jump in Python usage can help explain a broader rise in source growth.

If a TypeScript migration begins, the language curve may shift at the same time as [code churn](/blog/what-is-code-churn) rises.

## Connect language changes to repository activity

Account-level language data becomes much more useful when you can identify which repository caused the change.

Suppose Rust rises from 2% to 18% of a developer's total tracked language composition.

That could mean:

- an existing repository was partially rewritten in Rust
- a new Rust repository became active
- an older large repository was archived or removed from scope
- language detection changed because generated or vendored files changed

The aggregate percentage alone cannot tell you which explanation is correct.

Repository attribution can.

## Language mix can expose migration patterns

A migration often creates a characteristic pattern.

During the transition:

- the old language remains substantial
- the new language rises quickly
- churn increases
- net source growth may stay relatively flat
- commit activity may remain high
- the repository may temporarily contain both stacks

Later:

- the new language dominates
- the old language declines sharply
- churn normalizes
- growth returns to a steadier pattern

This is a good example of why language data should be read beside other metrics rather than in isolation.

## Absolute counts matter alongside percentages

Percentages can move even when a language's absolute size does not.

Imagine:

- Python stays at 100,000 bytes
- TypeScript grows from 50,000 to 300,000 bytes

Python's share falls dramatically, even though no Python was removed.

A percentage-only view might look like Python is disappearing.

An absolute-count view reveals that TypeScript simply grew faster.

The reverse can also happen: a language's share can rise because another language was deleted.

If possible, inspect both proportion and scale.

## Generated and vendored code can distort language views

Language analysis is only as clean as the files being counted.

Large generated directories can dominate a repository.

Examples include:

- generated SDKs
- compiled output
- vendored libraries
- build artifacts
- generated schemas
- embedded third-party code

Depending on repository configuration and language-detection rules, these files may affect the apparent language mix.

Unexpected jumps should therefore be treated as signals to investigate, not automatic conclusions.

## Repository scope changes can shift account-level language totals

If a developer authorizes a new repository, removes one, archives a project, or changes which repositories are included in an analytics system, the account-level language mix may change even without new coding activity.

This matters for longitudinal analysis.

A useful system should distinguish:

- actual source evolution
- scope changes
- repository additions or removals
- synchronization gaps

Otherwise, a data-coverage change can look like a technical shift.

## Language diversity is descriptive, not a score

More languages are not automatically better.

Fewer languages are not automatically better.

A project that consolidates onto one stack may become easier to maintain.

A developer who introduces a new language may be expanding into a new technical domain.

Neither outcome can be judged from the count alone.

Language diversity describes breadth. It does not measure engineering quality.

## Compare language history over meaningful windows

Useful comparisons include:

- current 30 days vs previous 30 days
- current quarter vs previous quarter
- current year vs previous year
- before migration vs after migration

Short windows can expose rapid changes.

Long windows show whether the change persisted.

The same idea applies to [source growth](/blog/measure-source-code-growth-over-time) and repository activity.

## Use language history to explain other charts

Language data becomes especially valuable when another metric moves unexpectedly.

Suppose net source growth rises sharply.

Check whether:

- a new language appeared
- one repository became dominant
- a migration started
- a generated codebase entered scope
- an old project was replaced

Suppose churn spikes but net growth stays flat.

Check whether one language is replacing another.

This is how multiple metrics become a coherent narrative.

## A practical workflow

To analyze programming-language usage across GitHub repositories:

1. Record the current language breakdown per repository.
2. Aggregate language totals across the selected repositories.
3. Compare the current period with an earlier snapshot.
4. Identify languages with the largest absolute and proportional changes.
5. Find which repositories caused those changes.
6. Check source growth and churn during the same period.
7. Look for milestones such as migrations, launches, rewrites, or new repositories.
8. Repeat over a longer window to see whether the shift persisted.

That approach avoids the most common mistake: treating today's language percentages as the whole history.

## Language usage is part of project evolution

A developer's language mix is not just a list of technologies.

Over time, it can reveal:

- migrations
- specialization
- expansion into new domains
- retirement of older stacks
- project handoffs
- new product phases

Dev Ledger treats language history as part of the broader longitudinal record alongside activity, repositories, source growth, and milestones.

For the larger framework, read [How to Analyze Your GitHub Development History](/blog/analyze-github-development-history).
