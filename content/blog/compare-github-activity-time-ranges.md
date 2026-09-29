---
slug: compare-github-activity-time-ranges
title: How to Compare GitHub Activity Across 7D, 30D, 90D, YTD, and 1Y
description: Choosing the right time range changes what GitHub analytics can tell you. Learn when to use short, medium, and long windows and how to compare them without misleading yourself.
date: 2026-09-29
updated: 2026-09-29
author: Noaman Ali
tags: GitHub activity, date range analytics, GitHub analytics, developer history
ogImage: /blog/compare-github-activity-time-ranges.png
---

The same developer history can tell completely different stories depending on the time window.

A seven-day view can show a release sprint. A 90-day view can show whether that sprint was exceptional. A one-year view can reveal whether the entire project changed direction.

This is why date range is not a cosmetic filter. It is part of the analysis.

## Every metric belongs to a period

A number without a time range is incomplete.

Consider:

- 80 commits
- 14 active days
- 12,000 additions
- 8,000 deletions
- 4,000 net source growth

Are those large or small?

The answer depends on whether they describe one week, one month, one quarter, one year, or an entire repository lifetime.

Before interpreting any GitHub metric, identify its window.

## Use 7D for immediate activity

A seven-day range is useful for very recent questions.

It can show:

- a current development burst
- a release push
- a debugging sprint
- whether a project was active this week
- short-term churn
- recent repository focus

Its weakness is volatility.

One unusual week can dominate the entire view.

A holiday, outage, migration, or single large commit can make seven-day metrics look dramatic.

Use 7D to understand what is happening *now*, not to generalize about long-term behavior.

## Use 30D for recent operating rhythm

Thirty days smooths some of the noise of a weekly window while remaining recent.

It is useful for:

- monthly development cadence
- active days
- current repository concentration
- recent source growth
- short-term language shifts
- month-over-month comparison

This is often a practical default because it contains enough activity to reveal patterns without hiding recent changes inside a long historical average.

## Use 90D for project phases

Ninety days is long enough to capture broader development cycles.

It can reveal:

- sustained migrations
- release phases
- repository revivals
- new project launches
- persistent changes in language mix
- whether a short-term spike became a trend

A 90-day view is especially useful when 7D or 30D appears unusual.

If the short window shows extremely high churn, 90D can tell you whether that intensity is normal for the project or a recent exception.

## Use YTD for the current year's direction

Year-to-date answers a different question:

**What has happened since the beginning of this calendar year?**

It is useful for:

- annual progress
- current-year project mix
- language evolution
- cumulative source growth
- major milestones
- comparison with the previous year

Its duration changes throughout the year.

In January, YTD is short. In September, it is much broader.

That makes YTD intuitive for calendar-based review, but less ideal for equal-length comparisons unless you compare it with the same period of the previous year.

## Use 1Y for rolling long-term context

A rolling one-year window avoids the changing length of YTD.

It is useful for:

- sustained project evolution
- annual seasonality
- repository lifecycle
- long-term language changes
- major shifts in development focus
- comparison with the previous rolling year

A rolling year is particularly useful when the current calendar year boundary would arbitrarily split a project phase.

## ALL is useful for history, not comparison

An all-time range gives scale.

It can show:

- total repository count
- long-run source evolution
- major project eras
- lifetime language mix
- first and latest activity
- major milestones

But it is usually poor for comparing recent intensity.

A project with five years of history will naturally accumulate enormous totals.

Use ALL to understand the complete arc, then move to narrower windows for interpretation.

## CUSTOM ranges answer event-specific questions

Custom date ranges are useful when development has known boundaries.

Examples:

- before and after a migration
- the three months leading to a release
- a hackathon period
- a contract phase
- a project revival
- the time between two major milestones

This can be more informative than preset windows because the dates align with the event you actually want to study.

## Compare equal-length periods whenever possible

If the goal is change detection, compare like with like.

Examples:

- last 7 days vs previous 7 days
- last 30 days vs previous 30 days
- last 90 days vs previous 90 days
- current rolling year vs previous rolling year

Equal-length windows reduce ambiguity.

Comparing 30 days with 90 days can still be useful, but raw totals will naturally differ because the periods have different lengths.

## Normalize when comparing unequal windows

If unequal ranges must be compared, rates can help.

Examples:

`commits per active day`

`churn per day`

`net source growth per week`

`active days / total days in range`

These rates can make periods more comparable.

But normalization should not replace raw totals entirely. A high rate over a tiny window can still be based on very little data.

## Short windows detect change; long windows validate it

A useful pattern is:

1. notice something in 7D or 30D
2. check 90D
3. inspect 1Y
4. locate the repositories responsible

Suppose 30D shows a sharp rise in [code churn](/blog/what-is-code-churn).

A 90D view may reveal that the spike began only two weeks ago.

A 1Y view may show that nothing similar happened previously.

That makes the current period genuinely unusual.

## Different metrics need different windows

Some signals are naturally short-term.

Examples:

- current activity
- recent commits
- release bursts
- active days

Others become more meaningful over longer ranges:

- language evolution
- repository lifecycle
- long-term source growth
- project transitions

This means one universal default range cannot answer every question equally well.

## Watch for partial-period bias

Calendar periods can be misleading when compared before they are complete.

For example:

- current month vs full previous month
- current quarter vs full previous quarter
- YTD vs full previous year

The current period has had less time to accumulate activity.

Either compare matched partial periods or label the asymmetry clearly.

## Repository changes can explain range changes

If 90D metrics look very different from 30D, check repository composition.

Maybe:

- a large project became dormant
- a new repository started
- an old repository was revived
- one project was archived
- a different language entered the mix

Time-range changes often reflect project-lifecycle changes.

See [Repository Lifecycle Analytics](/blog/repository-lifecycle-analytics) for that layer.

## A practical range-selection guide

Use:

- **7D** for immediate recent activity
- **30D** for current working rhythm
- **90D** for a project phase
- **YTD** for calendar-year review
- **1Y** for rolling long-term context
- **ALL** for the complete historical arc
- **CUSTOM** for event-specific analysis

Then compare the selected range with the previous equivalent period whenever possible.

## The range is part of the question

A metric does not become meaningful merely because it is precise.

The date range defines what the number is about.

That is why Dev Ledger treats range selection as a core analytical control rather than a visual preference.

A useful history should let you zoom between immediate activity and the longer arc without losing context.

For a broader workflow, read [How to Analyze Your GitHub Development History](/blog/analyze-github-development-history).
