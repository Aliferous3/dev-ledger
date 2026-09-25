import { useMemo, useState } from 'react';
import type { Period } from '../types';
import {
  inPeriod,
  MONTHS,
  type DayCell,
} from '../fieldData';
import { useLedger } from '../store/live';
import { ActivityHeader } from '../activity/ActivityHeader';
import { ActivityExtremes, type ExtremeRow } from '../activity/ActivityExtremes';
import { CircadianRadar } from '../activity/CircadianRadar';
import { RhythmStream } from '../activity/RhythmStream';
import { ActivityCharts, type MonthBucket, type WeekdayBucket } from '../activity/ActivityCharts';
import { ActivityMilestones, type Milestone } from '../activity/ActivityMilestones';
import { M12 } from '../ledger/m12';
import { SkChart, SkHeatmap, SkMetric, SkRows } from '../ledger/Skeleton';

interface Props {
  period: Period;
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const WD_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function maxBy(list: DayCell[], pick: (c: DayCell) => number): DayCell | null {
  let best: DayCell | null = null;
  for (const c of list) if (!best || pick(c) > pick(best)) best = c;
  return best && pick(best) > 0 ? best : null;
}

export function ActivityPage({ period }: Props) {
  // One owner for the dial focus: the header readout and the radar body
  // both consume `activeHour` — hover wins over the clicked selection.
  const [selectedHour, setSelectedHour] = useState<number>(18);
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const activeHour = hoveredSlice ?? selectedHour;

  // Live day-cells + weekday×hour rhythm from the dashboard store —
  // fixture fallback when the API is unreachable.
  const { cells, end, rhythm, resolving } = useLedger();

  // All date-addressable data derives from the same day-cell telemetry the
  // FIELD matrix reads, filtered by the canonical global period.
  const dayCells = useMemo(() => cells.filter((c) => inPeriod(c.date, period, end)), [cells, period, end]);

  const totalCommits = useMemo(
    () => dayCells.reduce((a, c) => a + c.commits, 0),
    [dayCells],
  );

  const extremes = useMemo<ExtremeRow[]>(() => {
    const rows: ExtremeRow[] = [];
    const mc = maxBy(dayCells, (c) => c.commits);
    if (mc)
      rows.push({
        id: 'commits', label: 'MOST COMMITS IN A DAY', valueNum: mc.commits, valueFmt: 'grouped',
        date: mc.iso, detail: `${WD[mc.date.getDay()]} · +${fmtCompact(mc.added)} / −${fmtCompact(mc.deleted)}`,
      });
    const ch = maxBy(dayCells, (c) => c.added + c.deleted);
    if (ch)
      rows.push({
        id: 'churn', label: 'HIGHEST CHURN DAY', valueNum: ch.added + ch.deleted, valueFmt: 'compact',
        date: ch.iso, detail: `${WD[ch.date.getDay()]} · ${ch.commits} COMMITS`,
      });
    const ad = maxBy(dayCells, (c) => c.added);
    if (ad)
      rows.push({
        id: 'added', label: 'MOST LINES ADDED', valueNum: ad.added, valueFmt: 'compact',
        date: ad.iso, detail: `${WD[ad.date.getDay()]} · −${fmtCompact(ad.deleted)} REMOVED`,
      });
    const de = maxBy(dayCells, (c) => c.deleted);
    if (de)
      rows.push({
        id: 'deleted', label: 'MOST LINES DELETED', valueNum: de.deleted, valueFmt: 'compact',
        date: de.iso, detail: `${WD[de.date.getDay()]} · +${fmtCompact(de.added)} ADDED`,
      });
    return rows;
  }, [dayCells]);

  const months = useMemo<MonthBucket[]>(() => {
    const map = new Map<string, MonthBucket>();
    for (const c of dayCells) {
      const key = `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, '0')}`;
      const b = map.get(key) ?? {
        key, name: `${MONTHS[c.date.getMonth()]} ${c.date.getFullYear()}`,
        letter: MONTHS[c.date.getMonth()][0], commits: 0, added: 0, deleted: 0,
      };
      b.commits += c.commits;
      b.added += c.added;
      b.deleted += c.deleted;
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [dayCells]);

  const weekdays = useMemo<WeekdayBucket[]>(() => {
    const sums = new Array(7).fill(0) as number[];
    for (const c of dayCells) sums[c.date.getDay()] += c.commits;
    const total = Math.max(1, sums.reduce((a, n) => a + n, 0));
    return WD_ORDER.map((name) => {
      const i = WD.indexOf(name);
      return { name, total: sums[i], pct: Math.round((sums[i] / total) * 1000) / 10 };
    });
  }, [dayCells]);

  // Milestones are canonical events of the record — computed all-time so a
  // crossed threshold stays a milestone regardless of the viewed window.
  const milestones = useMemo<Milestone[]>(() => {
    const sorted = [...cells].sort((a, b) => a.date.getTime() - b.date.getTime());
    const list: Milestone[] = [];
    const first = sorted.find((c) => c.commits > 0);
    if (first)
      list.push({ id: 'first', date: first.iso, title: 'FIRST OBSERVED COMMIT', desc: 'Cadence record begins' });
    let cum = 0;
    let i = 0;
    for (const target of [500, 1000]) {
      while (i < sorted.length && cum < target) {
        cum += sorted[i].commits;
        i++;
      }
      if (cum >= target)
        list.push({
          id: `c${target}`, date: sorted[i - 1].iso,
          title: `${target.toLocaleString('en-US')}TH COMMIT`,
          desc: `${target.toLocaleString('en-US')} commit threshold passed`,
        });
    }
    const churn = maxBy(cells, (c) => c.added + c.deleted);
    if (churn)
      list.push({
        id: 'churn', date: churn.iso, title: 'LARGEST SOURCE CHURN DAY',
        desc: `${fmtCompact(churn.added + churn.deleted)} churn recorded`,
      });
    return list.slice(0, 4);
  }, [cells]);

  const activeMonths = useMemo(
    () =>
      [...months]
        .sort((a, b) => b.commits - a.commits)
        .slice(0, 5)
        .map((m, i) => ({ rank: i + 1, commits: m.commits, date: m.key })),
    [months],
  );

  return (
    <section id="section-05" className="relative scroll-mt-28 space-y-8 md:space-y-12">
      {/* 1 — Page header: radar-style composition (lime eyebrow, serif
          title, mono sub) with the shared dial-focus readout on the right. */}
      <M12 i={0} id="activity-header">
        <ActivityHeader activeHour={activeHour} totalCommits={totalCommits} rhythm={rhythm} resolving={resolving} />
      </M12>

      {/* 2 — Extremes specification table (Blueprint source, real values) */}
      <M12 i={1} id="activity-extremes">
        {resolving ? (
          <div className="border border-neutral-800 bg-black/40 px-4 py-4">
            <SkRows rows={4} cols={[200, 112, 96, '1fr']} h={22} rowGap={18} />
          </div>
        ) : (
          <ActivityExtremes rows={extremes} />
        )}
      </M12>

      {/* 3 — Circadian radar body + distribution (hour state lifted here) */}
      <M12 i={2} id="activity-radar">
        {resolving ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-black/40 border border-neutral-900 p-6 md:p-8">
            <div className="lg:col-span-7"><SkChart h={280} /></div>
            <div className="lg:col-span-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkMetric key={i} labelW="40%" valueH={24} valueW={64} />
              ))}
            </div>
          </div>
        ) : (
          <CircadianRadar
            activeHour={activeHour}
            onHover={setHoveredSlice}
            onSelect={setSelectedHour}
            rhythm={rhythm}
          />
        )}
      </M12>

      {/* 4 — CRT RHYTHM_STREAM ASCII matrix (own probe sweep) */}
      <M12 i={3} id="activity-rhythm">
        {resolving ? (
          <SkHeatmap cols={24} rows={7} cell={14} gap={2} />
        ) : (
          <RhythmStream rhythm={rhythm} />
        )}
      </M12>

      {/* 5 — Three mini charts, real period-filtered data */}
      <M12 i={4} id="activity-charts">
        {resolving ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-neutral-900">
            <SkChart h={112} /><SkChart h={112} /><SkChart h={112} />
          </div>
        ) : (
          <ActivityCharts months={months} weekdays={weekdays} />
        )}
      </M12>

      {/* 6 — Milestones + active months ranking */}
      <M12 i={5} id="activity-milestones">
        {resolving ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-neutral-900">
            <SkRows rows={4} cols={[96, '1fr']} h={14} rowGap={16} />
            <SkRows rows={5} cols={['1fr', 56]} h={18} rowGap={14} />
          </div>
        ) : (
          <ActivityMilestones milestones={milestones} months={activeMonths} />
        )}
      </M12>
    </section>
  );
}
