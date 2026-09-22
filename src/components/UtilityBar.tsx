import { useEffect, useMemo, useState } from 'react';
import { formatLocalTime, resolveTimeZone } from '../ledger/sysTime.mjs';

// System utility bar — sparse hairline row above the main header.
// LEFT: local clock in the browser's IANA zone · RIGHT: CRT toggle.
// Sync status has exactly one surface: the SYNC.MON monitor (fixed
// bottom-right). No second indicator lives here.

export function UtilityBar({
  crtOn,
  onToggleCrt,
}: {
  crtOn: boolean;
  onToggleCrt: () => void;
}) {
  // null until the client clock ticks — a neutral placeholder beats an
  // incorrect render in any non-browser path.
  const [now, setNow] = useState<Date | null>(null);
  const timeZone = useMemo(resolveTimeZone, []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full border-b border-[#161616] bg-[#0a0a0a] px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[9px] mono-tag select-none">
      {/* LEFT — local system time + resolved IANA zone */}
      <span className="text-neutral-600 whitespace-nowrap">
        <span className="text-neutral-500">&gt;_</span> SYS.TIME //{' '}
        <span className="text-neutral-300 tabular-nums">{now ? formatLocalTime(now) : '--:--:--'}</span>
        {timeZone && (
          <span className="text-neutral-700 text-[8px]"> {timeZone.toUpperCase()}</span>
        )}
      </span>

      <div className="flex items-center gap-4 sm:gap-10">
        {/* CENTER/RIGHT — functional CRT scanline toggle */}
        <button
          type="button"
          onClick={onToggleCrt}
          aria-pressed={crtOn}
          className="text-neutral-500 hover:text-neutral-300 transition-colors whitespace-nowrap"
        >
          CRT SCANLINES{' '}
          <span className={crtOn ? 'text-[#d6ff3e]' : 'text-neutral-600'}>
            [{crtOn ? 'ON' : 'OFF'}]
          </span>
        </button>
      </div>
    </div>
  );
}
