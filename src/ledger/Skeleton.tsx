import type { CSSProperties, ReactNode } from 'react';

/* SK — Dev Ledger skeleton system. An unpopulated technical record:
   near-black #131413 fills, zinc hairline edges, a single low-luminance
   settle sweep. No shimmer gradients, no rounded SaaS cards, no fake
   words. All blocks are aria-hidden; a visually-hidden label announces
   the loading state once per region. */

export function SkBlock({
  w,
  h = 10,
  className = '',
  style,
}: {
  w?: number | string;
  h?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`sk ${className}`}
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        height: typeof h === 'number' ? `${h}px` : h,
        ...style,
      }}
    />
  );
}

/* Stacked text lines with naturally varying lengths — for paragraphs,
   descriptions and any copy-shaped loading region. */
export function SkText({
  lines = 3,
  h = 9,
  gap = 6,
  widths,
  className = '',
}: {
  lines?: number;
  h?: number;
  gap?: number;
  widths?: (number | string)[];
  className?: string;
}) {
  const ws = widths ?? ['100%', '82%', '64%', '91%', '48%'];
  return (
    <div aria-hidden className={`space-y-[${gap}px] ${className}`} style={{ rowGap: gap, display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkBlock key={i} h={h} w={ws[i % ws.length]} />
      ))}
    </div>
  );
}

/* Size-matched numeric skeleton — reserves the slot a real metric will
   occupy so values resolve in place without layout shift. Never a 0. */
export function SkNum({ h = 20, w = 72, className = '' }: { h?: number | string; w?: number | string; className?: string }) {
  return <SkBlock h={h} w={w} className={className} />;
}

/* A metric figure: label line over a value-sized block. */
export function SkMetric({ labelW = '40%', valueH = 28, valueW = 110, className = '' }: {
  labelW?: number | string;
  valueH?: number;
  valueW?: number | string;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      <SkBlock h={8} w={labelW} />
      <SkNum h={valueH} w={valueW} />
    </div>
  );
}

/* Structurally-correct table/list row — preserves column geometry so the
   resolved table doesn't shift. cols are CSS grid track widths. */
export function SkRows({
  rows = 5,
  cols = [80, '1fr', 60],
  h = 14,
  rowGap = 10,
  className = '',
}: {
  rows?: number;
  cols?: (number | string)[];
  h?: number;
  rowGap?: number;
  className?: string;
}) {
  const template = cols.map((c) => (typeof c === 'number' ? `${c}px` : c)).join(' ');
  return (
    <div aria-hidden className={className} style={{ display: 'flex', flexDirection: 'column', rowGap }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid items-center gap-3" style={{ gridTemplateColumns: template }}>
          {cols.map((_, c) => (
            <SkBlock key={c} h={h} w={c === cols.length - 1 ? '70%' : c === 0 ? '90%' : '100%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* Chart-space skeleton — axis rules + block geometry, never a fake line
   or fabricated trend. */
export function SkChart({ h = 160, className = '' }: { h?: number; className?: string }) {
  return (
    <div aria-hidden className={`sk relative ${className}`} style={{ height: h }}>
      <div className="absolute inset-x-4 bottom-4 top-4 flex flex-col justify-between">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-[#1e1f1d]" />
        ))}
      </div>
      <div className="absolute inset-x-4 bottom-4 top-4 flex items-end gap-[6%]">
        {[38, 62, 24, 71, 45, 57, 33].map((v, i) => (
          <div key={i} className="flex-1 bg-[#1e1f1d]" style={{ height: `${v}%` }} />
        ))}
      </div>
    </div>
  );
}

/* Dormant heatmap cells matching the contribution-field geometry. */
export function SkHeatmap({
  cols = 26,
  rows = 7,
  cell = 10,
  gap = 3,
  className = '',
}: {
  cols?: number;
  rows?: number;
  cell?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{ display: 'grid', gridTemplateRows: `repeat(${rows}, ${cell}px)`, gap }}
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="sk" style={{ width: cell, height: cell }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* Region wrapper — hides children while `loading` and renders the given
   skeleton, with one polite live announcement. Children never unmount
   early in the DOM sense: the swap is a single conditional so the
   skeleton exits as real content enters. */
export function SkRegion({
  loading,
  children,
  skeleton,
  label = 'loading',
}: {
  loading: boolean;
  children: ReactNode;
  skeleton: ReactNode;
  label?: string;
}) {
  if (!loading) return <>{children}</>;
  return (
    <div role="status" aria-label={label}>
      {skeleton}
    </div>
  );
}
