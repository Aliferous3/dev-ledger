import type { Period } from '../types';

// ZIP period label → a makeRange()-shaped range. `endIso` is the real
// last-observed day from live telemetry; `allFromIso` the first observed
// day. Pure production logic — no fixture data lives here.
export function periodToRange(
  period: Period,
  endIso: string,
  allFromIso: string,
): { mode: string; from: string | null; to: string | null } {
  const end = endIso;
  const shift = (days: number) => {
    const d = new Date(end + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  switch (period) {
    case '7D': return { mode: '7d', from: shift(6), to: end };
    case '30D': return { mode: '30d', from: shift(29), to: end };
    case '90D': return { mode: '90d', from: shift(89), to: end };
    case 'YTD': return { mode: 'ytd', from: `${end.slice(0, 4)}-01-01`, to: end };
    case 'ALL': return { mode: 'all', from: allFromIso, to: end };
    case '1Y':
    default: return { mode: '1y', from: shift(364), to: end };
  }
}


export function timelineEndIso(
  selectedRangeTo: string | null | undefined,
  allRangeTo: string | null | undefined,
  todayIso: string,
): string {
  return selectedRangeTo ?? allRangeTo ?? todayIso;
}
