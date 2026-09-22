import { useEffect, useState } from 'react';
import { getRhythmLevel } from '../activityData';
import type { RhythmBundle } from '../store/live';
import { usePrefersReducedMotion } from '../ledger/shared';
import { NumGrouped } from '../ledger/Num';

const BLOCKS = ['·', '░', '▒', '▓', '█'] as const;

/* [01] RHYTHM_STREAM — ASCII_MATRIX, extracted from ActivityTerminal
   (Design 02). The probe sweep is independent of the radar's dial focus:
   this is a telemetry sweep cursor, the radar is a manual inspector.
   Under prefers-reduced-motion the probe starts paused. */
export function RhythmStream({ rhythm }: { rhythm: RhythmBundle }) {
  const reduced = usePrefersReducedMotion();
  const [probeHour, setProbeHour] = useState<number>(18);
  const [runningSweep, setRunningSweep] = useState(() => !reduced);
  const [logLine, setLogLine] = useState('> telemetry lock: 2026-08-22 238c');

  useEffect(() => {
    if (!runningSweep) return;
    const interval = setInterval(() => {
      setProbeHour((h) => (h + 1) % 24);
    }, 1200);
    return () => clearInterval(interval);
  }, [runningSweep]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mono-tag text-[10px] text-neutral-400">
        <span className="text-[#d6ff3e]">[01] RHYTHM_STREAM — ASCII_MATRIX</span>
        <span className="flex items-center gap-4">
          <span className="text-neutral-500">
            PROBE AT <span className="text-[#d6ff3e]">{String(probeHour).padStart(2, '0')}:00 UTC</span>
          </span>
          <button
            type="button"
            onClick={() => setRunningSweep((v) => !v)}
            className="border border-neutral-800 px-2 py-0.5 text-neutral-400 hover:text-[#d6ff3e] hover:border-[#d6ff3e] transition-colors"
          >
            {runningSweep ? '[PAUSE PROBE]' : '[RESUME PROBE]'}
          </button>
        </span>
      </div>

      <div className="relative bg-black/60 border border-neutral-900 p-4 overflow-x-auto select-none">
        <div className="relative min-w-[700px] space-y-2">
          {/* Hour ruler */}
          <div className="grid grid-cols-[40px_1fr_40px] text-[8px] mono-tag text-neutral-600">
            <span />
            <div className="grid grid-cols-24 text-center">
              {Array.from({ length: 24 }).map((_, h) => (
                <span key={h} className={h === probeHour ? 'text-[#d6ff3e] font-bold' : ''}>
                  {h % 4 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
            </div>
            <span />
          </div>

          {/* Matrix rows with ASCII block chars */}
          {rhythm.days.map((d, dIdx) => (
            <div key={d.name} className="grid grid-cols-[40px_1fr_40px] items-center gap-2">
              <span className="mono-tag text-[9px] text-neutral-500">{d.name}</span>
              <div className="grid grid-cols-24 gap-[1px]">
                {Array.from({ length: 24 }).map((_, h) => {
                  const val = rhythm.matrix[dIdx][h];
                  const level = getRhythmLevel(val);
                  const isProbe = h === probeHour;
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-label={`${d.name} ${String(h).padStart(2, '0')}:00 — ${val} commits`}
                      onClick={() => {
                        setProbeHour(h);
                        setLogLine(`> inspected ${d.name} ${h}:00 -> ${val} commits`);
                      }}
                      className={`text-center font-mono text-[12px] cursor-pointer transition-all duration-150 ${
                        isProbe
                          ? 'text-[#d6ff3e] scale-125 font-bold shadow-[0_0_8px_rgba(214,255,62,0.8)]'
                          : level === 4
                            ? 'text-white'
                            : level === 3
                              ? 'text-neutral-300'
                              : level === 2
                                ? 'text-neutral-500'
                                : level === 1
                                  ? 'text-neutral-700'
                                  : 'text-neutral-900'
                      }`}
                    >
                      {BLOCKS[level]}
                    </button>
                  );
                })}
              </div>
              <span className="mono-tag text-[9px] text-neutral-500 text-right tabular-nums inline-flex justify-end"><NumGrouped value={d.total} /></span>
            </div>
          ))}
        </div>
      </div>

      {/* Live log strip */}
      <div className="flex items-center justify-between mono-tag text-[9px] text-neutral-600 border border-neutral-900 bg-neutral-950 p-2">
        <span className="text-[#d6ff3e]">{logLine}</span>
        <span>PEAK: {rhythm.highlights.peakWeekday} {rhythm.highlights.peakHour} ({rhythm.highlights.peakWeekdayTotal}c)</span>
      </div>
    </div>
  );
}
