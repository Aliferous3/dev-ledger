import type { Period } from '../types';
import { TerminalTicker } from './TerminalTicker';
import { SECTIONS, sectionLabel, useActiveSection } from '../sections';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
  navigate: (id: string, label: string) => void;
  firing: boolean;
  netGrowth: number;
  commits: number;
}

const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

const USER = {
  handle: '@Aliferous3',
  initials: 'A3',
  credit: 'DEVELOPED BY NOAMAN ALI',
};

/* Production header — BAND.10 KEYPAD adapted to the real six-view app.
   Row 2: brand + shortcut hint + RANGE readout + global period + user.
   Row 3: keypad nav keys (numeric shortcuts, Boot Log transitions).
   Row 4: the canonical telemetry marquee (unchanged). */
export function TerminalTickerHeader({ period, setPeriod, navigate, firing }: Props) {
  const active = useActiveSection();

  const go = (i: number) => {
    const s = SECTIONS[i];
    if (s) navigate(s.id, sectionLabel(s));
  };

  return (
    <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-neutral-900">
      <div
        tabIndex={0}
        onKeyDown={(e) => {
          if (firing) return;
          const t = e.target as HTMLElement;
          if (t.closest('input, textarea, [contenteditable="true"]')) return;
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= SECTIONS.length) {
            e.preventDefault();
            go(n - 1);
          }
        }}
        className="max-w-[1360px] mx-auto px-6 md:px-12 py-3 outline-none focus:ring-1 focus:ring-[#d6ff3e]/30"
      >
        {/* ROW 2 — brand / hint / range / user */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-[#d6ff3e] pulse-dot shrink-0" />
            <span className="mono-tag text-[11px] text-neutral-100 font-semibold tracking-[0.2em]">
              DEV LEDGER
            </span>
            <span className="text-neutral-700">/</span>
            <span className="mono-tag text-[10px] text-neutral-500 tracking-[0.2em]">
              CODE METRICS
            </span>
            <span className="mono-tag text-[9px] bg-[#d6ff3e] text-black px-1.5 py-0.5 font-bold shadow-[0_0_10px_rgba(214,255,62,.4)]">
              V1.3.0
            </span>
          </div>

          <span className="mono-tag text-[8px] text-neutral-600 hidden lg:inline">
            press 1–{SECTIONS.length} · focus panel
          </span>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <span className="mono-tag text-[8px] text-neutral-600">RANGE</span>
            <span className="mono-tag text-[10px] text-[#d6ff3e] bg-[#d6ff3e]/10 border border-[#d6ff3e]/40 px-2 py-0.5">
              {period}
            </span>
            <div className="flex items-center gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`mono-tag text-[8px] px-1.5 py-[3px] border transition-all ${
                    period === p
                      ? 'bg-[#d6ff3e] text-black border-[#d6ff3e] font-bold shadow-[0_0_10px_rgba(214,255,62,.45)]'
                      : 'border-neutral-800 text-neutral-400 hover:text-[#d6ff3e] hover:border-[#d6ff3e]/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <span className="w-px h-5 bg-neutral-800 mx-1 hidden md:block" />
            <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
              <span className="group flex items-center gap-2.5 cursor-pointer">
                <span className="relative shrink-0">
                  <span className="absolute -inset-[2px] rounded-full bg-[conic-gradient(from_180deg,#d6ff3e,#38bdf8,#f97316,#d6ff3e)] opacity-80 group-hover:opacity-100 transition-opacity spin-slower" />
                  <span className="relative w-6 h-6 text-[8px] rounded-full bg-[#0a0a0a] border border-black flex items-center justify-center mono-tag text-neutral-100 font-bold group-hover:text-[#d6ff3e] transition-colors">
                    {USER.initials}
                  </span>
                </span>
                <span className="mono-tag text-[10px] text-neutral-200 group-hover:text-[#d6ff3e] transition-colors tracking-[0.12em]">
                  {USER.handle}
                </span>
              </span>
              <span className="mono-tag text-[9px] text-neutral-600 hidden lg:inline-flex items-center gap-1 tracking-[0.18em]">
                {USER.credit}
                <span className="text-[8px]">↗</span>
              </span>
            </div>
          </div>
        </div>

        {/* ROW 3 — keypad nav: one key per major view, numeric shortcut */}
        <nav
          aria-label="Major views"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 mt-3"
        >
          {SECTIONS.map((s, i) => {
            const on = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => go(i)}
                className={`flex items-center justify-between px-3 py-2 border transition-all ${
                  on
                    ? 'border-[#d6ff3e] bg-[#d6ff3e] text-black'
                    : 'border-neutral-800 text-neutral-400 hover:border-[#d6ff3e]/50 hover:text-[#d6ff3e]'
                }`}
              >
                <span className="mono-tag text-[9px]">
                  {s.num} {s.name}
                </span>
                <kbd
                  className={`mono-tag text-[8px] px-1.5 py-0.5 border ${
                    on ? 'border-black/30 text-black/60' : 'border-neutral-800 text-neutral-600'
                  }`}
                >
                  {i + 1}
                </kbd>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ROW 4 — canonical telemetry marquee */}
      <TerminalTicker />
    </header>
  );
}
