import { useState } from 'react';
import type { Period, ArchiveTab } from '../types';
import { useLedger } from '../store/live';
import { useShapeDerived, Strata, Lifecycle, Fingerprint, WorkSpan } from '../retained/WorkShape';
import { SkChart } from '../ledger/Skeleton';
import { m12Delay, registerM12 } from '../ledger/m12';

interface Props {
  period: Period;
}

const FIGURE_TABS: ArchiveTab[] = [
  'F · 01 FINGERPRINT',
  'F · 02 SUCCESSION',
  'F · 03 LIFECYCLE',
  'F · 04 MIGRATION',
  'F · 05 SPAN',
];

const MYY = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const monthLabel = (ym: string) =>
  `${MYY[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;

/* SECTION 04 — LONGITUDINAL RECORD. The all-time figure set (fingerprint,
   succession, lifecycle, migration, span) over the full observed window.
   Figure switching is LOCAL state only: the keyed .archive-view swap runs a
   short fade — never a global preloader, page transition, or remount. */
export function Section04Longitudinal({ period }: Props) {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('F · 01 FINGERPRINT');
  // Interaction state shared by the retained figures (hover month / repo focus)
  const [hoverM, setHoverM] = useState<number | null>(null);
  const [repoFocus, setRepoFocus] = useState<string | null>(null);
  const [langFocus, setLangFocus] = useState<string | null>(null);
  // The longitudinal record is an all-time view — it consumes the unscoped
  // payload over the full observed span regardless of the global period pill.
  const { all, allFromIso, endIso, resolving } = useLedger();
  const derived = useShapeDerived(all, { mode: 'all', from: allFromIso, to: endIso });
  const rangeLabel = `PERIOD · ${period}`;
  // Dominant-repo migration runs, live from repoMonthly (fixture fallback
  // reproduces the previous MIGRATION_CARDS content).
  const migrations = (derived?.runs ?? []).map((r: any) => ({
    name: r.name,
    duration: `${r.months} MO`,
    span: r.from === r.to ? monthLabel(r.from) : `${monthLabel(r.from)} — ${monthLabel(r.to)}`,
  }));

  const figureBox = (children: React.ReactNode) => (
    <div className="bg-black/40 border border-neutral-900 p-6 md:p-8">{children}</div>
  );

  const unresolved = resolving ? (
    figureBox(<SkChart h={240} />)
  ) : !derived ? (
    figureBox(
      <div className="text-[9px] mono-tag text-neutral-600">
        INSUFFICIENT STORED HISTORY — THE RECORD RESOLVES ONCE COMMIT DATA EXISTS
      </div>
    )
  ) : null;

  return (
    <section id="section-04" className="relative scroll-mt-28 space-y-10">
      {/* Top Breadcrumb & Period Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[04] LONGITUDINAL</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">F · 00 — LONGITUDINAL RECORD</span>
          <span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
        <div className="flex flex-col items-end gap-2.5">
          <div className="text-[11px] mono-tag text-neutral-400">
            ARCHIVAL RECORD · {monthLabel(allFromIso)} — {monthLabel(endIso)}
          </div>
        </div>
      </div>

      {/* Figure navigation — local state swap, no preloader */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 sm:gap-8 pt-2 text-[10px] mono-tag border-b border-neutral-900 pb-3">
          {FIGURE_TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
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

      {/* Keyed figure region — remounts locally per figure; the section,
          tab strip, and page shell persist. */}
      <div key={activeTab} className="archive-view">
      {resolving || !derived ? unresolved : (
        <>
      {/* ===================================================================== */}
      {/* VIEW 01: F · 01 FINGERPRINT — retained Dev Ledger implementation        */}
      {/* ===================================================================== */}
      {activeTab === 'F · 01 FINGERPRINT' && figureBox(
        <Fingerprint dims={derived.dims} rangeLabel={rangeLabel} />
      )}

      {/* ===================================================================== */}
      {/* VIEW 02: F · 02 SUCCESSION — retained Dev Ledger implementation         */}
      {/* ===================================================================== */}
      {activeTab === 'F · 02 SUCCESSION' && figureBox(
        <Strata
          strata={derived.strata}
          axis={derived.axis}
          langFocus={langFocus}
          onHoverLang={setLangFocus}
          hoverM={hoverM}
          setHoverM={setHoverM}
        />
      )}

      {/* ===================================================================== */}
      {/* VIEW 03: F · 03 LIFECYCLE — retained Dev Ledger implementation          */}
      {/* ===================================================================== */}
      {activeTab === 'F · 03 LIFECYCLE' && figureBox(
        <Lifecycle
          spans={derived.spans}
          axis={derived.axis}
          hoverM={hoverM}
          repoFocus={repoFocus}
          setRepoFocus={setRepoFocus}
        />
      )}

      {/* ===================================================================== */}
      {/* VIEW 04: F · 04 MIGRATION — NEW design treatment                        */}
      {/* ===================================================================== */}
      {activeTab === 'F · 04 MIGRATION' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
            <span>WORK MIGRATION — DOMINANT REPOSITORY PER MONTH, IN SEQUENCE</span>
            <span className="text-neutral-500">{migrations.length} TRANSITIONS · F · 04</span>
          </div>

          <div className="bg-black/40 border border-neutral-900 p-6 md:p-8 space-y-8">
            {migrations.length === 0 ? (
              <div className="text-[9px] mono-tag text-neutral-600">
                INSUFFICIENT STORED HISTORY — MIGRATION RESOLVES ONCE COMMIT DATA EXISTS
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {migrations.map((card, i) => (
                <div
                  key={i}
                  ref={registerM12}
                  className="m12 border border-neutral-900 bg-neutral-950/60 p-6 space-y-2 hover:border-[#d6ff3e]/50 transition-colors"
                  style={m12Delay(i)}
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
            )}

            <div className="pt-4 border-t border-neutral-900 text-[9px] mono-tag text-neutral-500">
              SHARED = SECOND REPOSITORY ≥ 30% OF THE MONTH'S COMMITS
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 05: F · 05 SPAN — retained Dev Ledger implementation               */}
      {/* ===================================================================== */}
      {activeTab === 'F · 05 SPAN' && figureBox(
        <WorkSpan
          span={derived.span}
          spans={derived.spans}
          languages={derived.langCount}
        />
      )}
        </>
      )}
      </div>
    </section>
  );
}
