import { useCallback, useRef, useState } from 'react';
import type { DayData, MetricKey } from '../types';
import { smoothPath } from '../retained/primitives';
import { fmt } from '../codeData';
import { NumCompact } from '../ledger/Num';
import { useMediaQuery } from '../ledger/useMediaQuery';
import { buildMetricSeries, METRIC_META } from '../measure/metricModel.mjs';

const W = 1000;
const LIME = '#d6ff3e';

interface BinDay {
  i: number;           // index within the filtered series
  date: string;
  daily: number;       // selected metric value for that day
  cum: number;         // cumulative selected metric within the filtered range
  added: number;
  deleted: number;
  commits: number;
}

interface MonthBin {
  key: string;         // YYYY-MM
  label: string;       // SEP
  days: BinDay[];
  total: number;
}

const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/* One shared hover index across FIG.A and the day strips, as in the study.
   Pointer events (not mouse events) so touch scrubbing works — a tap or a
   horizontal drag selects an observation while vertical page scroll is
   left alone via touch-action: pan-y on the bound element. */
function useHoverIndex(n: number) {
  const [idx, setIdx] = useState<number | null>(null);
  const pick = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - r.left) / r.width;
      setIdx(Math.max(0, Math.min(n - 1, Math.floor(ratio * n))));
    },
    [n],
  );
  const clear = useCallback(() => setIdx(null), []);
  return {
    idx,
    setIdx,
    bind: { onPointerMove: pick, onPointerDown: pick, onPointerLeave: clear },
  };
}

const xAt = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
const log = (v: number, max: number) =>
  max <= 0 ? 0 : Math.log10(Math.max(0, v) + 1) / Math.log10(max + 1);
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

function FigHead({ tag, title, right }: { tag: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="mono-tag text-[10px]">
        <span className="text-[#d6ff3e]">{tag}</span>
        <span className="text-neutral-500"> — {title}</span>
      </div>
      <div className="mono-tag text-[9px] text-neutral-600">{right}</div>
    </div>
  );
}

function Readout({ d, left }: { d: BinDay; left: number }) {
  return (
    <div
      className="pointer-events-none absolute z-30 top-1"
      style={{ left }}
    >
      <div className="border border-[#d6ff3e]/60 bg-[#0b0b0b]/95 backdrop-blur px-2.5 sm:px-3 py-2 w-[172px] sm:w-[210px] shadow-[0_0_24px_rgba(214,255,62,.22)]">
        <div className="flex items-center justify-between gap-6 border-b border-neutral-800 pb-1.5">
          <span className="mono-tag text-[9px] text-neutral-400">{d.date}</span>
          <span className="mono-tag text-[9px] text-[#d6ff3e]">D.{d.i}</span>
        </div>
        <div className="flex items-baseline justify-between gap-6 pt-1">
          <span className="mono-tag text-[8px] text-neutral-500">CUMULATIVE</span>
          <span className="mono-tag text-[11px] tabular-nums text-neutral-100">{signed(d.cum)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-6 pt-1">
          <span className="mono-tag text-[8px] text-neutral-500">DAILY</span>
          <span className="mono-tag text-[11px] tabular-nums text-[#d6ff3e] glow-lime">
            {signed(d.daily)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 mono-tag text-[8px] text-neutral-500 pt-1">
          <span>COMMITS {d.commits}</span>
          <span>
            <span className="text-neutral-300">+{fmt(d.added)}</span>
            <span className="text-neutral-700"> / </span>
            <span className="text-neutral-500">−{fmt(d.deleted)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* FIG.03 — MONTH BINS. Every metric tab drives the same chart grammar:
   FIG.A is the cumulative selected metric, FIG.B is the same metric binned
   by month with day-level strips. The day stream is already dense across the
   selected calendar window, so inactive days/months remain visible as flats. */
export function MonthBins({ days, metric }: { days: DayData[]; metric: MetricKey }) {
  const n = days.length;
  const { idx, setIdx, bind } = useHoverIndex(n);
  const boxRef = useRef<HTMLDivElement>(null);
  const coarse = useMediaQuery('(pointer: coarse)');
  const [scrubbed, setScrubbed] = useState(false);
  const meta = METRIC_META[metric];

  const { series, months, minCum, maxCum, maxMonth } = (() => {
    const series = buildMetricSeries(days, metric) as BinDay[];
    const map = new Map<string, BinDay[]>();
    series.forEach((d) => {
      const key = d.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    });
    const months: MonthBin[] = [...map.entries()].map(([key, ds]) => ({
      key,
      label: MONTH_LABELS[parseInt(key.slice(5), 10) - 1],
      days: ds,
      total: ds.reduce((a, b) => a + b.daily, 0),
    }));
    return {
      series,
      months,
      minCum: Math.min(0, ...series.map((d) => d.cum)),
      maxCum: Math.max(0, ...series.map((d) => d.cum)),
      maxMonth: Math.max(1, ...months.map((m) => Math.abs(m.total))),
    };
  })();

  const H = 180;
  const pad = 6;
  const span = maxCum - minCum;
  const yAt = (v: number) =>
    span <= 0
      ? H - pad
      : pad + (H - pad * 2) * (1 - (v - minCum) / span);
  const pts = series.map((d) => ({
    x: xAt(d.i, n),
    y: yAt(d.cum),
  }));
  const zeroY = yAt(0);
  const line = smoothPath(pts);
  const cur = idx !== null ? series[idx] : null;

  return (
    <div className="relative border border-neutral-800 bg-[#080808] p-4 md:p-7 space-y-5 md:space-y-7 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 terminal-grid opacity-40" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="scan-line-horiz absolute top-0 bottom-0 w-1/5 bg-gradient-to-r from-transparent via-[#d6ff3e]/[0.05] to-transparent" />
      </div>
      <div className="relative space-y-5 md:space-y-7">
        {/* FIG. A — cumulative selected metric, lime gradient area */}
        <div>
          <FigHead tag="FIG. A" title={meta.figureTitle} right={`${n} OBS.`} />
          <div
            {...bind}
            ref={boxRef}
            className="relative cursor-crosshair select-none [-webkit-touch-callout:none]"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={(e) => {
              bind.onPointerDown(e);
              setScrubbed(true);
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {cur && (() => {
              const boxW = boxRef.current?.clientWidth ?? 0;
              const tipW = boxW < 480 ? 172 : 210;
              const xPx = n > 1 ? (idx! / (n - 1)) * boxW : 0;
              const left = Math.max(4, Math.min(xPx + (xPx > boxW * 0.55 ? -tipW - 10 : 10), boxW - tipW - 4));
              return <Readout d={cur} left={left} />;
            })()}
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[136px] sm:h-[180px]" preserveAspectRatio="none">
              <defs>
                <linearGradient id="binsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LIME} stopOpacity="0.35" />
                  <stop offset="55%" stopColor={LIME} stopOpacity="0.08" />
                  <stop offset="100%" stopColor={LIME} stopOpacity="0" />
                </linearGradient>
              </defs>
              {months.map((m) => {
                const x = xAt(m.days[0].i, n);
                return <line key={m.key} x1={x} y1="0" x2={x} y2={H} stroke="#151515" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
              })}
              {line && <path d={`${line} L ${W},${zeroY} L 0,${zeroY} Z`} fill="url(#binsAreaGrad)" />}
              {line && <path d={line} fill="none" stroke={LIME} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
              {idx !== null && cur && (
                <>
                  <line x1={xAt(idx, n)} y1="0" x2={xAt(idx, n)} y2={H} stroke={LIME} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                  <circle cx={xAt(idx, n)} cy={pts[idx].y} r="4" fill="#0a0a0a" stroke={LIME} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* FIG. B — month buckets with nested day strips */}
        <div
          className="select-none [-webkit-touch-callout:none]"
          onPointerLeave={() => setIdx(null)}
          onPointerDown={() => setScrubbed(true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <FigHead tag="FIG. B" title={meta.monthTitle} right={<span className="inline-flex gap-1">MAX <NumCompact value={maxMonth} /> / MO</span>} />
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-1.5">
            {months.map((m) => {
              const hot = m.days.some((d) => idx === d.i);
              const pk = Math.max(1, ...m.days.map((d) => Math.abs(d.daily)));
              return (
                <div key={m.key}
                  className={`border p-1.5 sm:p-2 transition-all duration-200 ${hot ? 'border-[#d6ff3e] bg-[#d6ff3e]/[0.07]' : 'border-neutral-900 bg-black/40 hover:border-neutral-700'}`}>
                  <div className={`mono-tag text-[8px] ${hot ? 'text-[#d6ff3e]' : 'text-neutral-500'}`}>{m.label}</div>
                  <div className="font-editorial text-base sm:text-lg text-neutral-100 leading-none mt-1 tabular-nums inline-flex"><NumCompact value={m.total} /></div>
                  <div className="h-1 bg-neutral-900 mt-2 overflow-hidden">
                    <div className="h-full bg-[#d6ff3e] transition-all duration-500" style={{ width: `${(Math.abs(m.total) / maxMonth) * 100}%` }} />
                  </div>
                  <div className="flex items-end gap-px h-6 sm:h-8 mt-2">
                    {m.days.map((d) => (
                      <span key={d.i}
                        onMouseEnter={() => setIdx(d.i)}
                        onPointerDown={() => setIdx(d.i)}
                        title={`${d.date} · ${signed(d.daily)}`}
                        className="flex-1 transition-colors"
                        style={{
                          height: `${Math.max(4, log(Math.abs(d.daily), pk) * 100)}%`,
                          background: idx === d.i ? LIME : d.daily > 0 ? '#8a8a8a' : '#1e1e1e',
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-900/70 mono-tag text-[9px]">
        <span className="text-neutral-600">// BINNED STREAM: {months.length} MONTH BUCKETS · DAY STRIPS NESTED INSIDE</span>
        <span
          className={`text-neutral-500 transition-opacity duration-700 ${
            coarse && scrubbed ? 'opacity-40' : ''
          }`}
        >
          {coarse ? 'LONG-PRESS + DRAG TO INSPECT' : 'HOVER / DRAG HORIZON TO INSPECT OBS.'}
        </span>
      </div>
    </div>
  );
}
