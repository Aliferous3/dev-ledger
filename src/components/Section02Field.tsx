import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Period } from '../types';
import {
  DOW,
  inPeriod,
  computeStats,
  formatBytes,
  type DayCell,
} from '../fieldData';
import { useLedger } from '../store/live';
import { CellTooltip } from '../field/Tooltip';
import { m12CellRef, m12Delay } from '../ledger/m12';
import { NumBytes, NumGrouped } from '../ledger/Num';
import { SkHeatmap, SkNum } from '../ledger/Skeleton';

interface Props {
  period: Period;
}

const BLOCKS = ['·', '░', '▒', '▓', '█'] as const;

/* Tooltip geometry for the portal HUD — estimated from CellTooltip's
   min-w/padding so it can flip/shift before hitting viewport edges. The
   width is resolved per-render so the compact mobile card (<480px) gets
   the tighter estimate. */
const TIP_W = 190;
const TIP_W_NARROW = 150;
const TIP_H = 130;
const TIP_GAP = 10;

export function Section02Field({ period }: Props) {
  // Live telemetry cells/weeks/languages from the dashboard store — falls
  // back to the bundled fixtures when the API is unreachable.
  const { cells, weeks, langs: languages, langTotal: languageTotal, end, all, resolving } = useLedger();
  const [hoverCell, setHoverCell] = useState<DayCell | null>(null);
  const [tipCoords, setTipCoords] = useState<{ cx: number; top: number; bottom: number } | null>(null);
  const [hoverLang, setHoverLang] = useState<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  // Language bar hover label — pixel position of the active segment's
  // center within the bar wrapper, so the label rides directly above it.
  const barWrapRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  const [segTip, setSegTip] = useState<{ x: number; w: number } | null>(null);

  // Shared pick for hover AND tap — a touch tap on a cell selects the day
  // and anchors the HUD exactly like a mouse hover.
  const pickCell = (cell: DayCell, el: HTMLElement) => {
    setHoverCell(cell);
    const r = el.getBoundingClientRect();
    setTipCoords({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };

  // Tap-away + scroll dismissal: phones have no hover-leave, and a fixed
  // tooltip anchored to captured cell coordinates would drift off on
  // scroll — so either gesture clears a tap/hover-selected day.
  useEffect(() => {
    if (!hoverCell) return;
    const clear = () => {
      setHoverCell(null);
      setTipCoords(null);
    };
    const onDown = (e: PointerEvent) => {
      if (matrixRef.current && !matrixRef.current.contains(e.target as Node)) clear();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', clear, { passive: true });
    matrixRef.current?.addEventListener('scroll', clear, { passive: true });
    const mx = matrixRef.current;
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', clear);
      mx?.removeEventListener('scroll', clear);
    };
  }, [hoverCell]);

  // Six-stat strip reacts to the canonical global period.
  const stats = useMemo(
    () =>
      computeStats(
        cells.filter((c) => inPeriod(c.date, period, end)),
        all.summary.repos,
      ),
    [period, cells, end, all],
  );

  // Viewport-aware fixed placement: flip below near the top edge, shift
  // horizontally near the side edges. Rendered via portal so no ancestor
  // overflow can clip it.
  const tipStyle = (() => {
    if (!tipCoords) return null;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const tipW = vw < 480 ? TIP_W_NARROW : TIP_W;
    const x = Math.min(Math.max(tipCoords.cx, tipW / 2 + 8), vw - tipW / 2 - 8);
    const flipBelow = tipCoords.top - TIP_H - TIP_GAP < 8;
    return {
      left: x,
      top: flipBelow ? tipCoords.bottom + TIP_GAP : tipCoords.top - TIP_GAP,
      transform: flipBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    };
  })();

  return (
    <section id="section-02" className="relative scroll-mt-28 space-y-8 md:space-y-12">
      {/* Top Breadcrumb — the global period selector lives in the sticky header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3 text-[11px] mono-tag text-neutral-300">
          <span className="text-[#d6ff3e] font-semibold">[02] FIELD</span>
          <span className="text-[#d6ff3e] cursor-blink">_</span>
        </div>
      </div>

      {/* Daily Contribution Matrix in Terminal Ticker Style */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <div className="flex items-center gap-2">
            <span>DAILY CONTRIBUTION FIELD</span>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-700 text-[8px] text-neutral-400">
              i
            </span>
          </div>
          <div className="text-neutral-400">
            <span className="text-[#d6ff3e] inline-flex"><NumGrouped value={stats.activeDays} /></span> / {cells.length || 365} DAYS ACTIVE
          </div>
        </div>

        {/* Matrix Container */}
        <div
          ref={matrixRef}
          className="relative bg-black/60 border border-neutral-900 p-3 sm:p-6 overflow-x-auto select-none"
          onMouseLeave={() => {
            setHoverCell(null);
            setTipCoords(null);
          }}
          onPointerDown={(e) => {
            // Tap on padding/labels clears a tap-selected day; taps on a
            // day cell ([data-day]) are handled by the cell's own handler.
            if (!(e.target as HTMLElement).closest('[data-day]')) {
              setHoverCell(null);
              setTipCoords(null);
            }
          }}
        >
          {/* CRT phantom sweep — slightly brighter but still atmospheric */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-45">
            <div className="scan-line-horiz absolute top-0 bottom-0 w-1/3 bg-gradient-to-r from-transparent via-[#d6ff3e]/[0.16] to-transparent" />
          </div>

          <div className="flex gap-2 min-w-[720px]">
            {resolving ? (
              <SkHeatmap cols={weeks.length || 52} rows={7} cell={12} gap={2} className="flex-1" />
            ) : (
            <>
            {/* Day of Week Labels */}
            <div className="flex flex-col justify-between py-[2px] pr-2 w-4 shrink-0">
              {DOW.map((d, i) => (
                <span
                  key={i}
                  className="h-[14px] text-[9px] leading-[14px] mono-tag text-neutral-600"
                >
                  {d}
                </span>
              ))}
            </div>

            {/* Matrix Grid */}
            <div className="flex-1">
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
                  gridTemplateRows: 'repeat(7, 14px)',
                  gridAutoFlow: 'column',
                }}
              >
                {weeks.map((week) =>
                  week.days.map((cell, di) => {
                    if (!cell) {
                      return <div key={`${week.index}-${di}`} className="bg-transparent" />;
                    }
                    const hovered = hoverCell?.iso === cell.iso;
                    const blockChar = BLOCKS[cell.intensity];

                    return (
                      <div
                        key={cell.iso}
                        ref={m12CellRef}
                        data-day
                        onMouseEnter={(e) => pickCell(cell, e.currentTarget)}
                        onPointerDown={(e) => pickCell(cell, e.currentTarget)}
                        className="m12 flex items-center justify-center text-[11px] leading-[14px] cursor-crosshair transition-all duration-100"
                        style={{
                          ...m12Delay(week.index),
                          color: hovered
                            ? '#d6ff3e'
                            : cell.intensity === 4
                            ? '#ffffff'
                            : cell.intensity === 3
                            ? '#c4c4c4'
                            : cell.intensity === 2
                            ? '#757575'
                            : cell.intensity === 1
                            ? '#484848'
                            : '#222222',
                          textShadow: hovered
                            ? '0 0 8px rgba(214,255,62,0.9)'
                            : cell.intensity === 4
                            ? '0 0 4px rgba(255,255,255,0.3)'
                            : 'none',
                          transform: hovered ? 'scale(1.4)' : 'scale(1)',
                          zIndex: hovered ? 20 : 1,
                        }}
                      >
                        {blockChar}
                      </div>
                    );
                  }),
                )}
              </div>

              {/* Month Markers */}
              <div
                className="grid mt-2"
                style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              >
                {weeks.map((week) => (
                  <div
                    key={week.index}
                    className="text-[9px] mono-tag text-neutral-600 leading-none"
                  >
                    {week.monthLabel ?? ''}
                  </div>
                ))}
              </div>
            </div>
            </>
            )}
          </div>

          {/* Tooltip HUD — portaled to body: escapes the scroll-clipped
              matrix container and stays inside the viewport */}
          {hoverCell && tipStyle && createPortal(
            <div
              className="fixed z-[70] pointer-events-none"
              style={tipStyle}
            >
              <CellTooltip cell={hoverCell} accent />
            </div>,
            document.body,
          )}
        </div>
      </div>

      {/* Six-stat strip — zip11 FieldC pattern, driven by the global
          period via computeStats over the real day cells. */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-neutral-900 border border-neutral-900">
        {[
          ['COMMITS', stats.commits],
          ['PULL_REQ', stats.prs],
          ['ACTIVE', stats.activeDays],
          ['MERGED', stats.merged],
          ['STREAK', stats.streak],
          ['REPOS', stats.repos],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-black px-3 py-4 md:py-5 group hover:bg-[#0a0a0a]">
            <div className="text-[9px] mono-tag text-neutral-600 group-hover:text-[#d6ff3e] transition-colors">
              {label}
            </div>
            <div className="mt-1.5 md:mt-2 text-xl md:text-2xl text-neutral-100 tabular-nums tracking-tight group-hover:text-[#d6ff3e] transition-colors">
              {resolving ? <SkNum h={22} w="60%" /> : <NumGrouped value={value as number} />}
            </div>
          </div>
        ))}
      </div>

      {/* Language Composition — segmented bar (zip11 FieldD). Hover shows a
          lime label attached directly above the active segment; language
          data is all-time (no period-filtered language feed exists). */}
      <div className="space-y-3 pt-6 border-t border-neutral-900/60">
        <div className="flex items-center justify-between text-[10px] mono-tag text-neutral-400">
          <span>LANGUAGE COMPOSITION</span>
          <span className="flex items-center gap-4">
            <span className="text-neutral-500">C · 01</span>
            <button
              type="button"
              aria-expanded={langOpen}
              aria-controls="lang-detail"
              onClick={() => setLangOpen((v) => !v)}
              className="text-neutral-500 hover:text-[#d6ff3e] transition-colors duration-200"
            >
              <span className="text-[#d6ff3e]">{langOpen ? '[-]' : '[+]'}</span>{' '}
              {langOpen ? 'COLLAPSE' : 'TRANSFORM'}
            </button>
          </span>
        </div>

        <div ref={barWrapRef} className="relative mt-9">
          {hoverLang &&
            segTip &&
            (() => {
              const l = languages.find((x) => x.name === hoverLang)!;
              const pct = (l.bytes / languageTotal) * 100;
              // Tick stays pinned to the segment center; the text clamps
              // independently inside the bar so edge segments can't push
              // it outside the panel. ~90px half-width covers the longest
              // "LANGUAGE · SIZE · PERCENT" readout.
              const x = Math.min(Math.max(segTip.x, 92), Math.max(segTip.w - 92, 92));
              return (
                <>
                  <div
                    className="absolute bottom-full mb-1.5 z-20 pointer-events-none"
                    style={{ left: segTip.x, transform: 'translateX(-50%)' }}
                  >
                    <div className="w-px h-4 bg-[#d6ff3e] mx-auto" />
                  </div>
                  <div
                    className="absolute bottom-full mb-[22px] z-20 pointer-events-none"
                    style={{ left: x, transform: 'translateX(-50%)' }}
                  >
                    <div className="text-[9px] mono-tag text-[#d6ff3e] whitespace-nowrap text-center">
                      {l.name.toUpperCase()} · {formatBytes(l.bytes)} · {pct.toFixed(1)}%
                    </div>
                  </div>
                </>
              );
            })()}
          <div className="flex h-14 md:h-16 gap-[3px]">
            {languages.map((l) => {
              const pct = (l.bytes / languageTotal) * 100;
              const isHovered = hoverLang === l.name;
              const isDim = hoverLang !== null && !isHovered;
              const trackSeg = (el: HTMLElement | null) => {
                if (!el || !barWrapRef.current) return;
                const s = el.getBoundingClientRect();
                const w = barWrapRef.current.getBoundingClientRect();
                setSegTip({ x: s.left - w.left + s.width / 2, w: w.width });
              };
              return (
                <button
                  key={l.name}
                  type="button"
                  aria-label={`${l.name}: ${formatBytes(l.bytes)}, ${pct.toFixed(1)} percent`}
                  onMouseEnter={(e) => {
                    setHoverLang(l.name);
                    trackSeg(e.currentTarget);
                  }}
                  onClick={(e) => {
                    // Touch taps fire focus (handled below) — this keeps
                    // the segment label on for the tap and lets tap-away
                    // blur dismiss it naturally.
                    setHoverLang(l.name);
                    trackSeg(e.currentTarget);
                  }}
                  onMouseLeave={() => {
                    setHoverLang(null);
                    setSegTip(null);
                  }}
                  onFocus={(e) => {
                    setHoverLang(l.name);
                    trackSeg(e.currentTarget);
                  }}
                  onBlur={() => {
                    setHoverLang(null);
                    setSegTip(null);
                  }}
                  className="relative cursor-pointer transition-all duration-150"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isHovered ? '#d6ff3e' : '#f0f0f0',
                    opacity: isDim ? 0.25 : 1,
                    boxShadow: isHovered ? '0 0 14px rgba(214,255,62,0.6)' : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Legend — centered as one composed unit under the bar on phones,
            left-aligned with the desktop rhythm ≥ sm. */}
        <div className="flex flex-wrap justify-center sm:justify-start gap-x-5 sm:gap-x-6 gap-y-2">
          {languages.map((l) => {
            const on = hoverLang === l.name;
            return (
              <button
                key={l.name}
                type="button"
                onMouseEnter={() => setHoverLang(l.name)}
                onMouseLeave={() => setHoverLang(null)}
                onFocus={() => setHoverLang(l.name)}
                onBlur={() => setHoverLang(null)}
                className={`text-[10px] mono-tag transition-colors ${
                  on ? 'text-[#d6ff3e]' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 mr-2 align-middle"
                  style={{ background: on ? '#d6ff3e' : '#f4f4f4' }}
                />
                {l.name.toUpperCase()}
                <span className="ml-2 text-neutral-600 inline-flex"><NumBytes value={l.bytes} /></span>
              </button>
            );
          })}
        </div>

        {/* [B] LANGUAGE_COMPOSITION — terminal row/detail view (zip11
            FieldC), same data + shared hoverLang cross-highlight. */}
        <div
          id="lang-detail"
          className={`grid transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
            langOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] mono-tag text-neutral-400">[B] LANGUAGE_COMPOSITION</div>
                <div className="text-[10px] mono-tag text-neutral-500">C · 01</div>
              </div>
              <div className="font-mono text-[11px] leading-6 text-neutral-400 overflow-x-auto">
                <div className="min-w-[420px]">
                  {languages.map((l) => {
                    const pct = l.bytes / languageTotal;
                    const filled = Math.max(1, Math.round(pct * 48));
                    const on = hoverLang === l.name;
                    return (
                      <div
                        key={l.name}
                        className="flex items-center gap-3 cursor-pointer"
                        onMouseEnter={() => setHoverLang(l.name)}
                        onMouseLeave={() => setHoverLang(null)}
                      >
                        <span className={`w-28 ${on ? 'text-[#d6ff3e]' : 'text-neutral-500'}`}>
                          {l.name.toLowerCase()}
                        </span>
                        <span className={on ? 'text-[#d6ff3e]' : 'text-neutral-300'}>
                          {'█'.repeat(filled)}
                          <span className="text-neutral-800">{'░'.repeat(48 - filled)}</span>
                        </span>
                        <span className={`w-20 text-right inline-flex justify-end ${on ? 'text-[#d6ff3e]' : 'text-neutral-600'}`}>
                          <NumBytes value={l.bytes} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
