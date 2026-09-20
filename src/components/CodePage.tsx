import { useMemo } from 'react';
import type { Period } from '../types';
import { cells, inPeriod } from '../fieldData';
import { DASHBOARD, periodToRange } from '../ledgerData';
import {
  LANGUAGES,
  LANGUAGE_TOTAL_BYTES,
  fmtBytes,
  fmtCompact,
} from '../codeData';
import { CodeHeader, type CodeTotals } from '../code/CodeHeader';
import { LanguageTreemap } from '../code/LanguageTreemap';
import { GrowthCurve, type GrowthPoint } from '../code/GrowthCurve';
import { ProjectTable, type ProjectRow } from '../code/ProjectTable';
import { CodeIntelligence, type IntelMetric } from '../code/CodeIntelligence';
import { ChurnTable, type ChurnRow } from '../code/ChurnTable';

const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

interface Props {
  period: Period;
}

// Month-granularity range test: a repoMonthly row ('YYYY-MM') counts when
// its month intersects the global period window.
function monthInRange(month: string, period: Period): boolean {
  const { from, to } = periodToRange(period);
  if (from && month < from.slice(0, 7)) return false;
  if (to && month > to.slice(0, 7)) return false;
  return true;
}

export function CodePage({ period }: Props) {
  // Line-change telemetry: same fieldData day-cells FIELD/Activity read.
  const lineStats = useMemo(() => {
    const vis = cells.filter((c) => inPeriod(c.date, period));
    let added = 0;
    let deleted = 0;
    let activeDays = 0;
    for (const c of vis) {
      added += c.added;
      deleted += c.deleted;
      if (c.commits > 0) activeDays++;
    }
    return { added, deleted, net: added - deleted, churn: added + deleted, activeDays };
  }, [period]);

  const totals: CodeTotals = {
    sourceBytes: fmtBytes(LANGUAGE_TOTAL_BYTES), // working-tree snapshot
    linesAdded: lineStats.added,
    linesDeleted: lineStats.deleted,
    netLines: lineStats.net,
    totalChurn: fmtCompact(lineStats.churn),
  };

  // Project churn is repo-attributed monthly telemetry — filtered to the
  // global period at month granularity (repoMonthly has no finer grain).
  const projects = useMemo<ProjectRow[]>(() => {
    const monthly = DASHBOARD.workShape.repoMonthly.filter((m) =>
      monthInRange(m.month, period),
    );
    return DASHBOARD.repositories.map((r) => {
      const rows = monthly.filter((m) => m.repository_id === r.id);
      return {
        name: r.name,
        bytes: r.languageBytes, // snapshot — bytes have no time dimension
        churn: rows.reduce((a, m) => a + m.added + m.deleted, 0),
      };
    });
  }, [period]);

  // Cumulative net-lines growth across the period's active months.
  const growth = useMemo<GrowthPoint[]>(() => {
    const byMonth = new Map<string, number>();
    for (const m of DASHBOARD.workShape.repoMonthly) {
      if (!monthInRange(m.month, period)) continue;
      byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.added - m.deleted);
    }
    let cum = 0;
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, net]) => {
        cum += Math.max(0, net);
        const mi = parseInt(month.slice(5, 7), 10) - 1;
        return { label: MONTH_NAMES[mi], value: cum };
      });
  }, [period]);

  const intel = useMemo<IntelMetric[]>(() => {
    const { added, deleted, net, churn, activeDays } = lineStats;
    const top = projects.reduce<ProjectRow | null>(
      (a, p) => (p.churn > (a?.churn ?? 0) ? p : a),
      null,
    );
    const projChurn = projects.reduce((a, p) => a + p.churn, 0);
    const churnPerDay = activeDays > 0 ? churn / activeDays : 0;
    const concentration = projChurn > 0 && top ? (top.churn / projChurn) * 100 : 0;
    return [
      {
        label: 'REFACTOR RATIO',
        value: added > 0 ? `${((deleted / added) * 100).toFixed(1)}%` : '—',
        sub: `${fmtCompact(deleted)} DEL / ${fmtCompact(added)} ADD`,
        pct: added > 0 ? (deleted / added) * 100 : 0,
      },
      {
        label: 'RETENTION RATIO',
        value: added > 0 ? `${((net / added) * 100).toFixed(1)}%` : '—',
        sub: `${fmtCompact(net)} NET / ${fmtCompact(added)} ADD`,
        pct: added > 0 ? Math.max(0, (net / added) * 100) : 0,
      },
      {
        label: 'CHURN / ACTIVE DAY',
        value: fmtCompact(churnPerDay),
        sub: `${fmtCompact(churn)} / ${activeDays} DAYS`,
        pct: Math.min(100, churnPerDay / 1000),
      },
      {
        label: 'CHURN CONCENTRATION',
        value: `${concentration.toFixed(1)}%`,
        sub: top ? top.name.toUpperCase() : '—',
        pct: concentration,
      },
    ];
  }, [lineStats, projects]);

  const churnRows = useMemo<ChurnRow[]>(
    () =>
      [...projects]
        .sort((a, b) => b.churn - a.churn)
        .map((p, i) => ({
          rank: String(i + 1).padStart(2, '0'),
          name: p.name,
          churn: p.churn,
        })),
    [projects],
  );

  return (
    <section id="section-06" className="relative scroll-mt-28 space-y-12">
      {/* 1 — Source composition header + totals */}
      <CodeHeader totals={totals} langCount={LANGUAGES.length} />

      {/* 2 — Language treemap mosaic (all 10 languages, name + size each) */}
      <LanguageTreemap />

      {/* 3 — Analysis row: growth curve | bytes/churn project table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-6 border-t border-neutral-900">
        <div className="lg:col-span-7">
          <div className="mono-tag text-[10px] text-[#d6ff3e] mb-4">
            $ GIT LOG --STAT --GRAPH // GROWTH
          </div>
          <GrowthCurve points={growth} />
        </div>
        <div className="lg:col-span-5">
          <ProjectTable projects={projects} />
        </div>
      </div>

      {/* 4 — Code Intelligence spec cards */}
      <CodeIntelligence metrics={intel} />

      {/* 5 — Source churn table */}
      <ChurnTable rows={churnRows} />
    </section>
  );
}
