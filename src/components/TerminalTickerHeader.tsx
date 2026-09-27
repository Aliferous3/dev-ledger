import type { Period } from '../types';
import { TerminalTicker } from './TerminalTicker';
import { AccountMenu } from './AccountMenu';
import { ShareButton } from '../share/ShareButton';
import { PAGES, type PageId } from '../pages';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
  page: PageId;
  navigate: (page: PageId) => void;
  netGrowth: number;
  commits: number;
  onShare: () => void;
  shareDisabled: boolean;
  onFeedback: () => void;
  feedbackOpen: boolean;
}

const PERIODS: Period[] = ['7D', '30D', '90D', 'YTD', '1Y', 'ALL'];

/* Production header — BAND.10 KEYPAD adapted to the three-page app.
   Row 2: brand + shortcut hint + RANGE readout + global period + user.
   Row 3: keypad nav — exactly OVERVIEW / ACTIVITY / CODE.
   Row 4: the canonical telemetry marquee (unchanged). */
export function TerminalTickerHeader({ period, setPeriod, page, navigate, onShare, shareDisabled, onFeedback, feedbackOpen }: Props) {
  return (
    <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-neutral-900">
      <div
        tabIndex={0}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('input, textarea, [contenteditable="true"]')) return;
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= PAGES.length) {
            e.preventDefault();
            navigate(PAGES[n - 1].id);
          }
        }}
        className="max-w-[1360px] mx-auto px-4 sm:px-6 md:px-12 py-1.5 md:py-3 outline-none focus:ring-1 focus:ring-[#d6ff3e]/30"
      >
        {/* ROW 2 — brand / hint / range / user. Below md this splits into
            two composed rows: brand + account on the first, the range
            keypad + share stretched across the second. Above md the order
            classes collapse back to the original single control row. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 md:gap-x-6 md:gap-y-3">
          <div className="flex items-center gap-2.5 md:gap-3 whitespace-nowrap order-1">
            <span className="w-2 h-2 rounded-full bg-[#d6ff3e] pulse-dot shrink-0" />
            <span className="mono-tag text-[11px] text-neutral-100 font-semibold tracking-[0.2em]">
              DEV LEDGER
            </span>
            <span className="text-neutral-700 hidden sm:inline">/</span>
            <span className="mono-tag text-[10px] text-neutral-500 tracking-[0.2em] hidden sm:inline">
              CODE METRICS
            </span>
            <span className="mono-tag text-[9px] bg-[#d6ff3e] text-black px-1 py-px md:px-1.5 md:py-0.5 font-bold shadow-[0_0_10px_rgba(214,255,62,.4)]">
              V1.3.0
            </span>
          </div>

          <span className="mono-tag text-[8px] text-neutral-600 hidden lg:inline order-2">
            press 1–{PAGES.length} · focus panel
          </span>

          {/* Account + credit — mobile: trailing cell of the brand row;
              desktop: last element of the control row. */}
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0 order-2 md:order-4">
            <AccountMenu />
            {/* Developer credit — always the author's GitHub, never the
                signed-in user's. Hidden in the dev preview so local demo
                footage carries no real account handle. */}
            {import.meta.env.PROD && (
              <a
                href="https://github.com/Aliferous3"
                target="_blank"
                rel="noopener noreferrer"
                className="group/credit mono-tag text-[9px] text-neutral-600 hover:text-neutral-400 hidden lg:inline-flex items-center gap-1 tracking-[0.18em] transition-colors"
              >
                DEVELOPED BY NOAMAN ALI
                <span className="text-[8px] transition-transform duration-200 group-hover/credit:translate-x-0.5 group-hover/credit:-translate-y-0.5">↗</span>
              </a>
            )}
          </div>

          {/* Controls — mobile: full-width second row, range keypad spans
              the width; desktop: unchanged inline cluster. The RANGE
              readout pill is redundant on mobile (the active key already
              carries state) so it stays desktop-only. */}
          <div className="flex items-center gap-2 order-3 basis-full md:basis-auto md:flex-wrap">
            <span className="mono-tag text-[8px] text-neutral-600 hidden md:inline">RANGE</span>
            <span className="mono-tag text-[10px] text-[#d6ff3e] bg-[#d6ff3e]/10 border border-[#d6ff3e]/40 px-2 py-0.5 hidden md:inline-flex">
              {period}
            </span>
            <div className="grid grid-cols-6 gap-1 flex-1 md:flex md:flex-none">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`mono-tag text-[8px] px-1.5 py-1.5 md:py-[3px] border transition-all text-center ${
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
            {/* SHARE — terminal-command action between the range controls
                and the account control. An action, not a fourth page. */}
            <ShareButton onShare={onShare} disabled={shareDisabled} />
            {/* DIAGNOSTIC DRAWER entry — the subordinate ▣ utility glyph
                between share and the account control (Concept 04). */}
            <button
              type="button"
              onClick={onFeedback}
              aria-label="Open diagnostic drawer — report a bug or request a feature"
              aria-haspopup="dialog"
              aria-expanded={feedbackOpen}
              className={`mono-tag text-[10px] px-1.5 py-1.5 md:py-[3px] border transition-all ${
                feedbackOpen
                  ? 'border-[#d6ff3e] text-[#d6ff3e]'
                  : 'border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'
              }`}
            >
              ▣
            </button>
            <span className="w-px h-5 bg-neutral-800 mx-1 hidden md:block" />
          </div>
        </div>

        {/* ROW 3 — page nav: exactly OVERVIEW / ACTIVITY / CODE. Compact
            centered keys on a phone; the [n] keypad hints are desktop
            chrome (they reference physical keys). */}
        <nav
          aria-label="Pages"
          className="grid grid-cols-3 gap-1.5 mt-1.5 md:mt-3"
        >
          {PAGES.map((p, i) => {
            const on = page === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate(p.id)}
                className={`flex items-center justify-center md:justify-between px-2 md:px-3 py-1.5 md:py-2 border transition-all ${
                  on
                    ? 'border-[#d6ff3e] bg-[#d6ff3e] text-black'
                    : 'border-neutral-800 text-neutral-400 hover:border-[#d6ff3e]/50 hover:text-[#d6ff3e]'
                }`}
              >
                <span className="mono-tag text-[9px]">
                  {p.num} {p.name}
                </span>
                <kbd
                  className={`mono-tag text-[8px] px-1.5 py-0.5 border hidden md:inline-block ${
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
