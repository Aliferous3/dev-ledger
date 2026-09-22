import { useMemo } from 'react';
import type { Period } from '../types';
import { inPeriod } from '../fieldData';
import { useLedger } from '../store/live';
import { fmtCompact } from '../codeData';
import { SkChart, SkMetric, SkRows } from '../ledger/Skeleton';
import { CodeHeader, type CodeTotals } from '../code/CodeHeader';
import { LanguageTreemap } from '../code/LanguageTreemap';
import { GrowthCurve, type GrowthPoint } from '../code/GrowthCurve';
import { ProjectTable, type ProjectRow } from '../code/ProjectTable';
import { CodeIntelligence, type IntelMetric } from '../code/CodeIntelligence';
import { ChurnTable, type ChurnRow } from '../code/ChurnTable';
import { M12 } from '../ledger/m12';

const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

interface Props {
  period: Period;
}

// Month-granularity range test: a repoMonthly row ('YYYY-MM') counts when
// its month intersects the global period window.
function monthInRange(
  month: string,
  range: { from: string | null; to: string | null },
): boolean {
  const { from, to } = range;
  if (from && month < from.slice(0, 7)) return false;
  if (to && month > to.slice(0, 7)) return false;
  return true;
}

export function CodePage({ period }: Props) {
  // Live telemetry: day-cells, language corpus and repoMonthly all come
  // from the dashboard store (fixture fallback when the API is offline).
  const { cells, end, all, range, langRows, resolving } = useLedger();
  // Line-change telemetry: same day-cells FIELD/Activity read.
  const lineStats = useMemo(() => {
    const vis = cells.filter((c) => inPeriod(c.date, period, end));
    let added = 0;
    let deleted = 0;
    let activeDays = 0;
    for (const c of vis) {
      added += c.added;
      deleted += c.deleted;
      if (c.commits > 0) activeDays++;
    }
    return { added, deleted, net: added - deleted, churn: added + deleted, activeDays };
  }, [cells, period, end]);

  const langTotal = langRows.reduce((a, l) => a + l.bytes, 0);
  const totals: CodeTotals = {
    sourceBytes: langTotal, // working-tree snapshot — raw bytes
    linesAdded: lineStats.added,
    linesDeleted: lineStats.deleted,
    netLines: lineStats.net,
    totalChurn: lineStats.churn,
  };

  // Project churn is repo-attributed monthly telemetry — filtered to the
  // global period at month granularity (repoMonthly has no finer grain).
  const projects = useMemo<ProjectRow[]>(() => {
    const monthly = all.workShape.repoMonthly.filter((m) =>
      monthInRange(m.month, range),
    );
    return all.repositories.map((r) => {
      const rows = monthly.filter((m) => m.repository_id === r.id);
      return {
        name: r.name,
        bytes: r.languageBytes, // snapshot — bytes have no time dimension
        churn: rows.reduce((a, m) => a + m.added + m.deleted, 0),
      };
    });
  }, [all, range]);

  // Cumulative net-lines growth across the period's active months.
  const growth = useMemo<GrowthPoint[]>(() => {
    const byMonth = new Map<string, number>();
    for (const m of all.workShape.repoMonthly) {
      if (!monthInRange(m.month, range)) continue;
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
  }, [all, range]);

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
        valueNum: added > 0 ? (deleted / added) * 100 : null,
        valueFmt: 'pct',
        sub: `${fmtCompact(deleted)} DEL / ${fmtCompact(added)} ADD`,
        pct: added > 0 ? (deleted / added) * 100 : 0,
      },
      {
        label: 'RETENTION RATIO',
        valueNum: added > 0 ? (net / added) * 100 : null,
        valueFmt: 'pct',
        sub: `${fmtCompact(net)} NET / ${fmtCompact(added)} ADD`,
        pct: added > 0 ? Math.max(0, (net / added) * 100) : 0,
      },
      {
        label: 'CHURN / ACTIVE DAY',
        valueNum: churnPerDay,
        valueFmt: 'compact',
        sub: `${fmtCompact(churn)} / ${activeDays} DAYS`,
        pct: Math.min(100, churnPerDay / 1000),
      },
      {
        label: 'CHURN CONCENTRATION',
        valueNum: concentration,
        valueFmt: 'pct',
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
      <M12 i={0} id="code-header">
        <CodeHeader totals={totals} langCount={langRows.length} resolving={resolving} />
      </M12>

      {/* 2 — Language treemap mosaic (name + size per language) */}
      <M12 i={1} id="code-treemap">
        {resolving ? (
          <div className="flex gap-px border border-neutral-900">
            {[42, 27, 18, 13].map((w, i) => (
              <div key={i} style={{ flexBasis: `${w}%` }}>
                <SkChart h={160} className="border-0" />
              </div>
            ))}
          </div>
        ) : (
          <LanguageTreemap langs={langRows} />
        )}
      </M12>

      {/* 3 — Analysis row: growth curve | bytes/churn project table */}
      <M12 i={2} id="code-growth">
        {resolving ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-6 border-t border-neutral-900">
            <div className="lg:col-span-7"><SkChart h={190} /></div>
            <div className="lg:col-span-5"><SkRows rows={6} cols={[24, '1fr', 72]} h={15} rowGap={20} /></div>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-6 border-t border-neutral-900">
          <div className="lg:col-span-7">
            <div className="mono-tag text-[10px] text-[#d6ff3e] mb-4">
              $ GIT LOG --STAT --GRAPH // GROWTH
            </div>
            <GrowthCurve points={growth} />
          </div>
          <div className="lg:col-span-5" id="code-projects">
            <ProjectTable projects={projects} />
          </div>
        </div>
        )}
      </M12>

      {/* 4 — Code Intelligence spec cards */}
      <M12 i={3} id="code-intel">
        {resolving ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="relative border border-neutral-800 p-4 bg-neutral-950/40">
                <SkMetric labelW="60%" valueH={34} valueW={90} />
              </div>
            ))}
          </div>
        ) : (
          <CodeIntelligence metrics={intel} />
        )}
      </M12>

      {/* 5 — Source churn table */}
      <M12 i={4} id="code-churn">
        {resolving ? (
          <div className="border border-neutral-800 bg-black/40 px-4 py-3">
            <SkRows rows={6} cols={[24, '1fr', 128, 64]} h={14} rowGap={18} />
          </div>
        ) : (
          <ChurnTable rows={churnRows} />
        )}
      </M12>
    </section>
  );
}
