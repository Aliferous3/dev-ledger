import { useEffect, useState } from 'react';
import { useLedger } from '../store/live';

// System utility bar — sparse hairline row above the main header.
// LEFT: live UTC clock · CENTER/RIGHT: CRT scanlines toggle · RIGHT: sync status.

function utcNow() {
  return new Date().toISOString().slice(11, 19);
}

export function UtilityBar({
  crtOn,
  onToggleCrt,
}: {
  crtOn: boolean;
  onToggleCrt: () => void;
}) {
  const [time, setTime] = useState(utcNow);
  const { dash, live } = useLedger();
  // Live sync state from /api/dashboard — fixture mode reports SYNCED.
  const syncing = live && dash.sync.status === 'syncing';
  const syncLabel = syncing
    ? `SYNCING ${Math.round((dash.sync.progress ?? 0) * 100)}%`
    : live && dash.sync.status === 'revoked'
      ? 'GITHUB REVOKED'
      : live && dash.sync.status === 'error'
        ? 'SYNC ERROR'
        : 'ALL OBS. SYNCED';

  useEffect(() => {
    const id = setInterval(() => setTime(utcNow()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full border-b border-[#161616] bg-[#0a0a0a] px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[9px] mono-tag select-none">
      {/* LEFT — live UTC system time, fixed-width so layout never jumps */}
      <span className="text-neutral-600 whitespace-nowrap">
        <span className="text-neutral-500">&gt;_</span> SYS.TIME //{' '}
        <span className="text-neutral-300 tabular-nums">{time}</span>
        <span className="text-neutral-600"> UTC</span>
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

        {/* RIGHT — sync status */}
        <span className="flex items-center gap-1.5 text-neutral-500 whitespace-nowrap">
          <span className={`inline-block w-1.5 h-1.5 rounded-full pulse-dot ${syncing ? 'bg-amber-400' : 'bg-[#d6ff3e]'}`} />
          {syncLabel}
        </span>
      </div>
    </div>
  );
}
