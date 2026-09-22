import { smoothPath } from '../retained/primitives';
import { NumCompact } from '../ledger/Num';

export interface GrowthPoint {
  label: string; // 'SEP'
  value: number; // cumulative net lines
}

/* CODE GROWTH — real cumulative net-lines curve projected into the
   study's 760×210 frame (CodeShared.GrowthCurve, lime accent variant). */
export function GrowthCurve({ points }: { points: GrowthPoint[] }) {
  const n = Math.max(points.length, 2);
  const max = Math.max(...points.map((p) => p.value), 1);
  const pts = points.map((p, i) => ({
    x: (i / (n - 1)) * 760,
    y: 200 - (p.value / max) * 190,
  }));
  const line = smoothPath(pts);
  const area = `${line} L 760 210 L 0 210 Z`;
  const last = pts[pts.length - 1];

  // Sparse month labels — every ~nth bucket so they never collide
  const step = Math.max(1, Math.ceil(points.length / 10));

  return (
    <div className="relative h-[190px]">
      <svg viewBox="0 0 760 210" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d6ff3e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="200" x2="760" y2="200" stroke="#1c1c1c" strokeWidth="1" />
        <line x1="0" y1="52" x2="760" y2="52" stroke="#1c1c1c" strokeWidth="1" strokeDasharray="3 3" />
        <path d={area} fill="url(#growthGrad)" />
        <path d={line} fill="none" stroke="#d6ff3e" strokeWidth="1.6" />
        {last && <circle cx={last.x} cy={last.y} r="3.5" fill="#d6ff3e" className="pulse-dot" />}
      </svg>
      <div className="flex justify-between mono-tag text-[9px] text-neutral-600 pt-1">
        {points.map((p, i) => (
          <span key={i} className="flex-1 text-center truncate">
            {i % step === 0 ? p.label : ''}
          </span>
        ))}
      </div>
      <div className="mono-tag text-[8px] text-neutral-600 mt-1 inline-flex gap-1">
        CUMULATIVE NET SOURCE ADDITIONS · PEAK <NumCompact value={max} />
      </div>
    </div>
  );
}
