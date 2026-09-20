import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Period } from '../types';
import { useLedger } from '../store/live';
import { formatBytes } from '../fieldData';

/* ================================================================== */
/* PROJECTS / PAGE 02 — HTOP / PROCESS MONITOR                         */
/* Ported from the design study (zip10 terminalVariants.tsx, 06).      */
/* The study's local PeriodBar is removed — the view consumes the      */
/* canonical app-level period instead. Table rows join the real        */
/* REPOSITORIES directory to repoMonthly aggregates for the period.    */
/* ================================================================== */

const stateColor = (s: string) =>
  s === 'ACTIVE'
    ? 'text-[#d6ff3e]/80'
    : s === 'STEADY'
      ? 'text-neutral-400'
      : s === 'QUIET'
        ? 'text-neutral-500'
        : 'text-neutral-600';

interface Props {
  period: Period;
  /** Page switcher rendered where the study's PeriodBar sat. */
  pager?: ReactNode;
}

export function ProjHtop({ period, pager }: Props) {
  const { all, repos: REPOSITORIES, range } = useLedger();
  const [sel, setSel] = useState('D.01');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, []);
  const jitter = (m: number, i: number) =>
    Math.max(1, Math.min(100, m + Math.round(Math.sin((tick + i * 3) / 2) * 3)));

  // Real per-repo aggregates for the global period — repoMonthly months
  // are filtered to the period's range; momentum is a normalized blend
  // of commit and churn share within that window.
  const { rows, totals } = useMemo(() => {
    const fromM = range.from?.slice(0, 7) ?? '0000-00';
    const toM = range.to?.slice(0, 7) ?? '9999-99';
    const idByName = new Map(all.repositories.map((r) => [r.name, r.id]));
    const agg = new Map<string, { commits: number; days: number; churn: number }>();
    for (const m of all.workShape.repoMonthly) {
      if (m.month < fromM || m.month > toM) continue;
      const a = agg.get(m.repository_id) ?? { commits: 0, days: 0, churn: 0 };
      a.commits += m.commits;
      a.days += m.activeDays;
      a.churn += m.added + m.deleted;
      agg.set(m.repository_id, a);
    }
    const list = REPOSITORIES.map((r) => {
      const a = agg.get(idByName.get(r.name) ?? '') ?? { commits: 0, days: 0, churn: 0 };
      return { ...r, ...a };
    });
    const maxC = Math.max(...list.map((r) => r.commits), 1);
    const maxCh = Math.max(...list.map((r) => r.churn), 1);
    const ranked = list
      .map((r) => ({
        ...r,
        momentum: Math.min(
          99,
          Math.round(100 * (0.6 * (r.commits / maxC) + 0.4 * (r.churn / maxCh))),
        ),
        churnStr: r.churn > 0 ? formatBytes(r.churn) : '0',
      }))
      .sort((a, b) => b.momentum - a.momentum);
    return {
      rows: ranked,
      totals: {
        commits: list.reduce((a, r) => a + r.commits, 0),
        churn: list.reduce((a, r) => a + r.churn, 0),
        days: list.reduce((a, r) => a + r.days, 0),
      },
    };
  }, [range, all]);

  const momAvg = Math.round(rows.reduce((a, r) => a + r.momentum, 0) / Math.max(rows.length, 1));
  const churnIo = Math.min(99, Math.round((totals.churn / Math.max(all.summary.allChurn, 1)) * 100));
  const stateCount = (s: string) => REPOSITORIES.filter((r) => r.status === s).length;

  return (
    <section>
      {/* Stat band — study header kept, period pills replaced by the
          canonical Projects page switcher. */}
      <div className="border border-neutral-800 bg-[#0c0c0c] p-5 md:p-6 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mono-tag text-[10px] text-neutral-300 tracking-[0.24em]">PROJECTS</div>
            <div className="mono-tag text-[9px] text-neutral-500 mt-1 tracking-[0.2em]">
              AUTHORIZED GITHUB REPOSITORIES · RANKED BY MOMENTUM · {period}
            </div>
          </div>
          {pager}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-neutral-900 mt-2">
          {[
            ['REPOSITORIES', String(REPOSITORIES.length)],
            ['TOTAL CHURN', totals.churn > 0 ? formatBytes(totals.churn) : '0'],
            ['COMMITS', totals.commits.toLocaleString('en-US')],
            ['ACTIVE DAYS', String(totals.days)],
          ].map(([k, v], i) => (
            <div
              key={k}
              className={`py-4 ${i > 0 ? 'md:border-l md:border-neutral-900 md:pl-6' : ''} group cursor-default`}
            >
              <div className="mono-tag text-[9px] text-neutral-500 group-hover:text-[#d6ff3e] transition-colors">
                {k} I
              </div>
              <div className="font-editorial text-5xl text-neutral-100 mt-1 group-hover:text-[#d6ff3e] transition-colors tabular-nums">
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-neutral-800 bg-black glow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-900 bg-[#0e0e0e]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
            <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
            <span className="w-2 h-2 rounded-full bg-[#d6ff3e] orb-pulse" />
            <span className="mono-tag text-[9px] text-neutral-400 ml-2">LEDGER.TOP — MONITOR</span>
          </div>
          <span className="mono-tag text-[8px] text-neutral-600">
            UPTIME {Math.floor(tick / 60)}:{String(tick % 60).padStart(2, '0')} · LIVE
          </span>
        </div>

        <div className="p-5 font-mono text-[11px] overflow-x-auto">
          <div className="min-w-[640px]">
            {/* header gauges */}
            <div className="grid md:grid-cols-2 gap-x-10 gap-y-1 mb-4">
              <Gauge label="MOM AVG" pct={jitter(momAvg, 0)} />
              <Gauge label="CHURN IO" pct={jitter(churnIo, 1)} />
              <div className="mono-tag text-[9px] text-neutral-500 mt-1">
                Tasks: <span className="text-neutral-200">{REPOSITORIES.length}</span> total,{' '}
                <span className="text-[#d6ff3e]">{stateCount('ACTIVE')}</span> running,{' '}
                <span className="text-neutral-400">{stateCount('STEADY')}</span> steady,{' '}
                <span className="text-neutral-500">{stateCount('QUIET')}</span> quiet,{' '}
                <span className="text-neutral-600">{stateCount('DORMANT')}</span> dormant
              </div>
              <div className="mono-tag text-[9px] text-neutral-500 mt-1">
                Load average: <span className="text-[#d6ff3e]">{(rows[0]?.momentum ?? 0) / 100}</span>{' '}
                {((rows[1]?.momentum ?? 0) / 100).toFixed(2)} {((rows[2]?.momentum ?? 0) / 100).toFixed(2)} · {period}
              </div>
            </div>

            <div className="grid grid-cols-[36px_44px_1.7fr_1.3fr_0.6fr_0.6fr_0.6fr_0.8fr] gap-2 px-2 py-1.5 bg-[#d6ff3e]/10 text-[#d6ff3e] mono-tag text-[9px]">
              <span>PID</span>
              <span>PRI</span>
              <span>COMMAND</span>
              <span>MOM%</span>
              <span className="text-right">CHURN</span>
              <span className="text-right">CMT</span>
              <span className="text-right">DAYS</span>
              <span className="text-right">STATE</span>
            </div>
            {rows.map((r, i) => {
              const on = sel === r.id;
              const m = jitter(r.momentum, i);
              const bars = Math.round((m / 100) * 24);
              return (
                <button
                  key={r.id}
                  onClick={() => setSel(r.id)}
                  className={`w-full text-left grid grid-cols-[36px_44px_1.7fr_1.3fr_0.6fr_0.6fr_0.6fr_0.8fr] gap-2 px-2 py-1.5 transition-colors ${
                    on ? 'bg-[#d6ff3e] text-black' : 'hover:bg-white/[0.04] text-neutral-300'
                  }`}
                >
                  <span className="tabular-nums">{1000 + i * 111}</span>
                  <span className="tabular-nums">{20 - i}</span>
                  <span className="truncate">
                    {r.locked ? '🔒 ' : ''}./{r.name}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">
                    <span className={on ? 'text-black' : 'text-neutral-600'}>[</span>
                    <span className={on ? 'text-black' : 'text-[#d6ff3e]'}>{'|'.repeat(bars)}</span>
                    <span className={on ? 'text-black/40' : 'text-neutral-800'}>{'.'.repeat(24 - bars)}</span>
                    <span className={on ? 'text-black' : 'text-neutral-600'}>]</span>
                    <span className="ml-1">{m}%</span>
                  </span>
                  <span className="text-right tabular-nums">{r.churnStr}</span>
                  <span className="text-right tabular-nums">{r.commits}</span>
                  <span className="text-right tabular-nums">{r.days}</span>
                  <span className={`text-right mono-tag text-[9px] ${on ? 'text-black' : stateColor(r.status)}`}>
                    {r.status}
                  </span>
                </button>
              );
            })}

            <div className="flex flex-wrap gap-1 mt-4 pt-3 border-t border-neutral-900">
              {['F1 Help', 'F2 Setup', 'F3 Search', 'F4 Filter', 'F5 Tree', 'F6 SortBy', 'F9 Kill', 'F10 Quit'].map((f) => (
                <span key={f} className="mono-tag text-[9px]">
                  <span className="text-neutral-500">{f.split(' ')[0]}</span>
                  <span className="bg-[#d6ff3e]/15 text-[#d6ff3e] px-1.5 py-0.5 ml-0.5">{f.split(' ')[1]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Gauge({ label, pct }: { label: string; pct: number }) {
  const bars = Math.round((Math.min(100, pct) / 100) * 30);
  return (
    <div className="flex items-center gap-2 mono-tag text-[9px]">
      <span className="text-neutral-500 w-16">{label}</span>
      <span className="text-neutral-600">[</span>
      <span className="tracking-tighter">
        <span className="text-[#d6ff3e]">{'|'.repeat(bars)}</span>
        <span className="text-neutral-800">{'.'.repeat(30 - bars)}</span>
      </span>
      <span className="text-neutral-600">]</span>
      <span className="text-neutral-300 tabular-nums w-9">{pct}%</span>
    </div>
  );
}
