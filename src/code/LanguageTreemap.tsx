import { useState } from 'react';
import type { LangRow } from '../codeData';

/* Language treemap — Attachment 1 mosaic from CodeTreemap (CODE.03).
   Every tile carries name + size, including the small strip; tiles are
   keyboard-focusable and focus mirrors the hover state. Layout reflows:
   big tile full-width on mobile, mid pair halves, small strip wraps. */
export function LanguageTreemap({ langs }: { langs: LangRow[] }) {
  const [hov, setHov] = useState<string | null>(null);
  const big = langs[0];
  const mid = langs.slice(1, 3);
  const small = langs.slice(3);
  const hovLang = hov ? langs.find((l) => l.name === hov) : null;

  if (!big)
    return (
      <div className="mono-tag text-[9px] text-neutral-600">
        NO LANGUAGE TELEMETRY — RESOLVES AFTER FIRST SYNC
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mono-tag text-[10px] text-neutral-400">
        <span>LANGUAGE TREEMAP</span>
        <span className={hovLang ? 'text-[#d6ff3e]' : 'text-neutral-600'}>
          {hovLang
            ? `${hovLang.name} · ${hovLang.size} · ${hovLang.pct}%`
            : `${langs.length} LANGUAGES`}
        </span>
      </div>

      <div className="grid grid-cols-12 gap-1.5 md:h-[320px]">
        <Tile
          l={big}
          span="col-span-12 md:col-span-8 md:row-span-2 h-28 md:h-auto"
          hov={hov}
          setHov={setHov}
          big
        />
        <div className="col-span-12 md:col-span-4 grid grid-cols-2 md:grid-cols-1 md:grid-rows-2 gap-1.5">
          {mid.map((l) => (
            <Tile key={l.name} l={l} span="h-16 md:h-auto" hov={hov} setHov={setHov} />
          ))}
        </div>
        <div className="col-span-12 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
          {small.map((l) => (
            <Tile key={l.name} l={l} span="h-9 sm:h-16" hov={hov} setHov={setHov} tiny />
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({
  l,
  span = '',
  hov,
  setHov,
  big = false,
  tiny = false,
}: {
  l: LangRow;
  span?: string;
  hov: string | null;
  setHov: (v: string | null) => void;
  big?: boolean;
  tiny?: boolean;
}) {
  const on = hov === l.name;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${l.name} — ${l.size}, ${l.pct}% of source`}
      onMouseEnter={() => setHov(l.name)}
      onMouseLeave={() => setHov(null)}
      onFocus={() => setHov(l.name)}
      onBlur={() => setHov(null)}
      className={`${span} relative overflow-hidden cursor-pointer transition-all duration-200 outline-none ${
        tiny
          ? // Phones: one-line chip (name · size) so a KB-scale language
            // never occupies a tall card; ≥sm keeps the stacked tile look.
            'flex flex-row items-center justify-between px-2.5 py-1.5 sm:flex-col sm:items-stretch sm:justify-between sm:p-3'
          : 'flex flex-col justify-between p-3'
      }`}
      style={{
        background: on ? '#d6ff3e' : big ? '#f2f2f2' : tiny ? '#3a3a3a' : '#c9c9c9',
        opacity: hov && !on ? 0.3 : 1,
        boxShadow: on ? '0 0 26px rgba(214,255,62,.6)' : 'none',
      }}
    >
      <span
        className={`mono-tag ${tiny ? 'text-[8px]' : 'text-[9px]'} ${
          on ? 'text-black' : tiny ? 'text-neutral-300' : 'text-neutral-600'
        }`}
      >
        {l.name}
      </span>
      <span
        className={`${
          tiny ? 'mono-tag text-[9px]' : `font-editorial ${big ? 'text-5xl' : 'text-2xl'}`
        } tabular-nums ${on ? 'text-black' : tiny ? 'text-neutral-200' : 'text-neutral-900'}`}
      >
        {l.size}
      </span>
    </div>
  );
}
