import { RHYTHM_HIGHLIGHTS } from '../activityData';

/* Page header — Attachment 2 composition (lime eyebrow, serif title, mono
   sub, divider) with the DIAL FOCUS readout bound to the shared radar
   hour state owned by ActivityPage. */
export function ActivityHeader({
  activeHour,
  totalCommits,
}: {
  activeHour: number;
  totalCommits: number;
}) {
  const [pwStart, pwEnd] = RHYTHM_HIGHLIGHTS.peakWindow.split('–').map((s) => parseInt(s, 10));
  const inPeak = activeHour >= pwStart && activeHour <= pwEnd;

  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-900 pb-6">
      <div>
        <div className="mono-tag text-[10px] text-[#d6ff3e]">
          [05] ACTIVITY<span className="cursor-blink">_</span>
          <span className="text-neutral-500"> // TEMPORAL CADENCE · 24H CIRCADIAN PROFILE</span>
        </div>
        <h2 className="font-editorial text-4xl sm:text-5xl text-neutral-100 mt-2">Activity</h2>
        <div className="mono-tag text-[9px] text-neutral-500 mt-1">
          POLAR PROJECTION OF {totalCommits.toLocaleString('en-US')} COMMITS ACROSS 24 HOURS
        </div>
      </div>

      {/* Hour Focus Indicator — reflects the radar's active hour */}
      <div className="border border-neutral-800 bg-black/60 p-4 min-w-[200px] text-right space-y-1">
        <div className="mono-tag text-[8px] text-neutral-500">DIAL FOCUS</div>
        <div className="font-editorial text-4xl text-[#d6ff3e] tabular-nums">
          {String(activeHour).padStart(2, '0')}:00 UTC
        </div>
        <div className="mono-tag text-[8px] text-neutral-400">
          {inPeak ? '★ PEAK CADENCE WINDOW' : 'CIRCADIAN TRACK'}
        </div>
      </div>
    </div>
  );
}
