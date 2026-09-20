import { useState } from 'react';
import type { Period, ArchiveTab } from '../types';
import { MIGRATION_CARDS } from '../store/metricsData';
import { DASHBOARD, ARCHIVE_RANGE } from '../ledgerData';
import { useShapeDerived, Strata, Lifecycle, Fingerprint, WorkSpan } from '../retained/WorkShape';
import { useBootTransition } from '../transitions/BootLog';

interface Props {
  period: Period;
  setPeriod: (p: Period) => void;
}

const ARCHIVE_TABS: ArchiveTab[] = [
  'F · 01 FINGERPRINT',
  'F · 02 SUCCESSION',
  'F · 03 LIFECYCLE',
  'F · 04 MIGRATION',
  'F · 05 SPAN',
];

export function Section04Archive({ period, setPeriod }: Props) {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('F · 01 FINGERPRINT');
  const { firing, fire, overlay } = useBootTransition();
  // Interaction state shared by the retained figures (hover month / repo focus)
  const [hoverM, setHoverM] = useState<number | null>(null);
  const [repoFocus, setRepoFocus] = useState<string | null>(null);
  const [langFocus, setLangFocus] = useState<string | null>(null);
  const derived = useShapeDerived(DASHBOARD, ARCHIVE_RANGE);
  const rangeLabel = `PERIOD · ${period}`;

  return (
    <section id="section-04" className="relative scroll-mt-28 space-y-10">
      {/* Top Breadcrumb & Period Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[04] ARCHIVE</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">F · 00 — LONGITUDINAL RECORD</span>
          <span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
        <div className="flex flex-col items-end gap-2.5">
          <div className="text-[11px] mono-tag text-neutral-400">
            ARCHIVAL RECORD · JAN 2024 — SEP 2026
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] mono-tag text-neutral-500">PERIOD</span>
            {(['7D', '30D', '90D', 'YTD', '1Y', 'ALL'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-[9px] mono-tag px-2 py-0.5 border transition-all ${
                  period === p
                    ? 'bg-[#d6ff3e] text-black border-[#d6ff3e] font-semibold'
                    : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hero Title */}
      <div className="space-y-4">
        <h2 className="font-editorial text-4xl sm:text-5xl md:text-6xl font-normal text-neutral-100 tracking-tight">
          The Shape of Your Work
        </h2>

        {/* Sub Navigation Tabs */}
        <div className="flex flex-wrap gap-4 sm:gap-8 pt-2 text-[10px] mono-tag border-b border-neutral-900 pb-3">
          {ARCHIVE_TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => { if (!firing && tab !== activeTab) fire(tab, () => setActiveTab(tab)); }}
                className={`tab-underline py-1 transition-colors duration-200 ${
                  active
                    ? 'active text-neutral-100 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {active && <span className="text-[#d6ff3e] mr-1.5">//</span>}
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* VIEW 01: F · 01 FINGERPRINT — retained Dev Ledger implementation        */}
      {/* ===================================================================== */}
      {activeTab === 'F · 01 FINGERPRINT' && (
        <div className="bg-black/40 border border-neutral-900 p-6 md:p-8">
          {derived ? (
            <Fingerprint dims={derived.dims} rangeLabel={rangeLabel} />
          ) : (
            <div className="text-[9px] mono-tag text-neutral-600">
              INSUFFICIENT STORED HISTORY — THE FIELD RESOLVES ONCE COMMIT DATA EXISTS
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 02: F · 02 SUCCESSION — retained Dev Ledger implementation         */}
      {/* ===================================================================== */}
      {activeTab === 'F · 02 SUCCESSION' && (
        <div className="bg-black/40 border border-neutral-900 p-6 md:p-8">
          {derived && (
            <Strata
              strata={derived.strata}
              axis={derived.axis}
              langFocus={langFocus}
              onHoverLang={setLangFocus}
              hoverM={hoverM}
              setHoverM={setHoverM}
            />
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 03: F · 03 LIFECYCLE — retained Dev Ledger implementation          */}
      {/* ===================================================================== */}
      {activeTab === 'F · 03 LIFECYCLE' && (
        <div className="bg-black/40 border border-neutral-900 p-6 md:p-8">
          {derived && (
            <Lifecycle
              spans={derived.spans}
              axis={derived.axis}
              hoverM={hoverM}
              repoFocus={repoFocus}
              setRepoFocus={setRepoFocus}
            />
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 04: F · 04 MIGRATION — NEW design treatment                        */}
      {/* ===================================================================== */}
      {activeTab === 'F · 04 MIGRATION' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
            <span>WORK MIGRATION — DOMINANT REPOSITORY PER MONTH, IN SEQUENCE</span>
            <span className="text-neutral-500">4 TRANSITIONS · F · 04</span>
          </div>

          <div className="bg-black/40 border border-neutral-900 p-6 md:p-8 space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {MIGRATION_CARDS.map((card, i) => (
                <div
                  key={i}
                  className="border border-neutral-900 bg-neutral-950/60 p-6 space-y-2 hover:border-[#d6ff3e]/50 transition-colors"
                >
                  <div className="text-[9px] mono-tag text-neutral-500">0{i + 1} // {card.span}</div>
                  <div className="font-editorial text-xl md:text-2xl text-neutral-100">
                    {card.name}
                  </div>
                  <div className="text-[10px] mono-tag text-[#d6ff3e]">
                    {card.duration}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-neutral-900 text-[9px] mono-tag text-neutral-500">
              SHARED = SECOND REPOSITORY ≥ 30% OF THE MONTH'S COMMITS
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 05: F · 05 SPAN — retained Dev Ledger implementation               */}
      {/* ===================================================================== */}
      {activeTab === 'F · 05 SPAN' && (
        <div className="bg-black/40 border border-neutral-900 p-6 md:p-8">
          {derived && (
            <WorkSpan
              span={derived.span}
              spans={derived.spans}
              languages={derived.langCount}
            />
          )}
        </div>
      )}
      {overlay}
    </section>
  );
}
