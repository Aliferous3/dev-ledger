import type { Ref } from 'react';
import {
  DOW_LABELS,
  SHARE_CARD,
  contributionLayout,
  contributionWeeks,
  fmtCompact,
  fmtHumanRange,
  fmtInt,
  gitLogCommand,
  type ShareRecordData,
} from './shareModel.ts';
import { CAT_BODY_PATH, CAT_INNER_LEFT, CAT_INNER_RIGHT } from './ShareIcons.tsx';

/* The canonical Share Record — portrait 9:16 technical record at
   1080×1920. Rendered as pure SVG so the in-app preview and the exported
   PNG are the same source: the modal scales this node, the exporter
   serializes it. Monochrome by design — the acid accent lives in the
   application chrome, not the exported artifact. */

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const W = SHARE_CARD.width;
const H = SHARE_CARD.height;

// Contribution intensity → grayscale ramp (zero activity stays near-black).
const LEVELS = ['#141414', '#2a2a2a', '#4a4a4a', '#999999', '#f0f0f0'] as const;

export function ShareCard({
  record,
  ref,
}: {
  record: ShareRecordData;
  ref?: Ref<SVGSVGElement>;
}) {
  const weeks = contributionWeeks(record.startDate, record.endDate, record.daily);

  // Cell size adapts to the real number of week columns — short ranges get
  // larger cells, long histories stay truthful by shrinking (fractional
  // sub-pixel cells if necessary), never by dropping days or padding
  // phantom columns. contributionLayout guarantees the grid fits availW.
  const cols = Math.max(1, weeks.length);
  const availW = 800;
  const { cell, gap } = contributionLayout(cols, availW);
  const gridX = 178;
  const gridH = 7 * cell + 6 * gap;
  // Contribution block sits vertically centered in the panel's lower half
  // (below the metrics divider at y1038, panel bottom edge ~1398).
  const blockTop = 1050 + Math.max(0, (340 - gridH - 30) / 2);
  const monthsY = blockTop + 14;
  const gridY = blockTop + 32;
  const rowH = cell + gap;
  // Month labels thin out so they never collide on long histories, and
  // drop entirely once columns go sub-pixel (pitch < 3px ≈ >5 years) —
  // at that density the strip is the record, not the labels.
  const minLabelStep = 46;
  const labeledCols = new Set<number>();
  if (cell + gap >= 3) {
    let lastLabelX = -Infinity;
    weeks.forEach((wk, wi) => {
      const x = gridX + wi * (cell + gap);
      if (wk.month != null && x - lastLabelX >= minLabelStep) {
        labeledCols.add(wi);
        lastLabelX = x;
      }
    });
  }

  // Hero caret placement — "lines of code." is 13 chars at 0.6em advance.
  const heroFont = 35;
  const caretX = 140 + 13 * (heroFont * 0.6) + 4;

  // Footer identity — right-aligned @login with the mark to its left and a
  // hairline divider separating it from the provenance text.
  const userText = `@${record.username}`;
  const userW = userText.length * 22 * 0.6;
  const logoX = 1000 - userW - 46;
  const dividerX = logoX - 30;

  const metrics: [string, string][] = [
    [fmtInt(record.netSourceGrowth), 'lines of code'],
    [fmtCompact(record.sourceAdded), 'added'],
    [fmtCompact(record.sourceDeleted), 'deleted'],
    [fmtInt(record.activeDays), 'active days'],
    [fmtInt(record.pullRequests), 'pull requests'],
  ];

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Dev Ledger share record — ${record.period}, ${record.startDate} to ${record.endDate}`}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <defs>
        <pattern id="sr-grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M60 0H0V60" fill="none" stroke="#ffffff" strokeOpacity="0.022" strokeWidth="1" />
        </pattern>
      </defs>

      {/* background */}
      <rect width={W} height={H} fill="#0d0d0d" />
      <rect width={W} height={H} fill="url(#sr-grid)" />

      {/* restrained orbital construction lines */}
      <circle cx="1080" cy="205" r="330" fill="none" stroke="#1c1c1c" strokeWidth="1.5" />
      <circle cx="60" cy="1820" r="430" fill="none" stroke="#181818" strokeWidth="1.5" />
      <circle cx="880" cy="1730" r="340" fill="none" stroke="#1b1b1b" strokeWidth="1" />

      {/* thin outer inset border */}
      <rect x="30" y="30" width={W - 60} height={H - 60} fill="none" stroke="#ffffff" strokeOpacity="0.07" />

      {/* sparse node / crosshair registration marks */}
      {[
        [170, 44], [432, 120], [966, 172], [24, 418], [1012, 488], [142, 692], [1014, 760],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" fill="#2b2b2b" />
      ))}
      {[
        [150, 1438], [502, 1752], [968, 300],
      ].map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}`} stroke="#2e2e2e" strokeWidth="1.5" fill="none" />
      ))}

      {/* top-left tick + top-right selected range */}
      <path d="M82 96H118" stroke="#4a4a4a" strokeWidth="2" />
      <text x="1000" y="98" textAnchor="end" fontFamily={MONO} fontSize="25" letterSpacing="2" fill="#9b9b93">
        {fmtHumanRange(record.startDate, record.endDate)}
      </text>
      <path d="M946 118H1000" stroke="#555555" strokeWidth="2" />

      {/* hero block */}
      <path d="M82 262V525" stroke="#3f3f3f" strokeWidth="3" />
      <text x="140" y="335" fontFamily={MONO} fontSize={heroFont} fill="#b9b9b1">I wrote</text>
      <text x="140" y="455" fontFamily={MONO} fontSize="108" fontWeight="500" letterSpacing="-3" fill="#f0f0ea">
        {fmtInt(record.netSourceGrowth)}
      </text>
      <text x="140" y="528" fontFamily={MONO} fontSize={heroFont} fill="#b9b9b1">lines of code.</text>
      {/* the terminal caret — blinks in the live preview via .share-caret;
          the exported SVG carries no external CSS so it renders solid */}
      <text x={caretX} y="528" fontFamily={MONO} fontSize={heroFont} fill="#b9b9b1" className="share-caret">_</text>

      {/* terminal metrics panel */}
      <rect x="85" y="575" width="913" height="863" rx="8" fill="#0f0f0f" stroke="#2b2b2b" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={122 + i * 24} cy="608" r="7" fill="#3d3d3d" />
      ))}
      <text x="225" y="617" fontFamily={MONO} fontSize="25" fill="#8f8f87">GitHub</text>
      <path d="M86 655H997" stroke="#242424" strokeWidth="1.5" />

      <text x="122" y="706" fontFamily={MONO} fontSize="25" fill="#c9c9c1">
        {gitLogCommand(record.startDate, record.endDate)}
      </text>
      <text x="122" y="750" fontFamily={MONO} fontSize="25" fill="#565650">...</text>

      {metrics.map(([v, l], i) => (
        <g key={l} fontFamily={MONO} fontSize="26">
          <text x="352" y={806 + i * 47} textAnchor="end" fill="#ecece4">{v}</text>
          <text x="392" y={806 + i * 47} fill="#797971">{l}</text>
        </g>
      ))}

      <path d="M86 1038H997" stroke="#242424" strokeWidth="1.5" />

      {/* contribution record — real selected-range daily activity */}
      {weeks.map((wk, wi) => {
        const x = gridX + wi * (cell + gap);
        return (
          <g key={wi}>
            {labeledCols.has(wi) && (
              <text x={x} y={monthsY} fontFamily={MONO} fontSize="17" letterSpacing="1" fill="#63635c">
                {wk.month}
              </text>
            )}
            {wk.days.map((d, di) =>
              d ? (
                <rect
                  key={d.date}
                  x={x}
                  y={gridY + di * rowH}
                  width={cell}
                  height={cell}
                  rx={Math.min(2, cell / 4)}
                  fill={LEVELS[d.intensity]}
                />
              ) : null,
            )}
          </g>
        );
      })}
      {/* weekday labels thin out with the cells: full set when a row can
          hold the text, every other row on medium grids, none when the
          history is so long the labels would just overlap */}
      {rowH >= 19
        ? DOW_LABELS.map((d, i) => (
            <text
              key={d}
              x="122"
              y={gridY + i * rowH + cell - Math.max(2, cell * 0.22)}
              fontFamily={MONO}
              fontSize="17"
              fill="#55554f"
            >
              {d}
            </text>
          ))
        : rowH >= 10
          ? DOW_LABELS.filter((_, i) => i % 2 === 0).map((d, i) => (
              <text
                key={d}
                x="122"
                y={gridY + i * 2 * rowH + cell - Math.max(2, cell * 0.22)}
                fontFamily={MONO}
                fontSize="14"
                fill="#55554f"
              >
                {d}
              </text>
            ))
          : null}

      {/* cat silhouette — dark body, thin rim, partially off-canvas,
          sitting behind the footer band */}
      <g transform="translate(575,1355) scale(5.6)">
        <path d={CAT_BODY_PATH} fill="#101010" stroke="#3d3d3d" strokeWidth="0.5" />
        <path d={CAT_INNER_LEFT} fill="none" stroke="#262626" strokeWidth="1.2" strokeLinecap="round" />
        <path d={CAT_INNER_RIGHT} fill="none" stroke="#262626" strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* footer */}
      <path d={`M${dividerX} 1806V1850`} stroke="#2c2c2c" strokeWidth="1.5" />
      <path d={`M${dividerX} 1850H1000`} stroke="#2a2a2a" strokeWidth="1.5" />
      <text x="80" y="1830" fontFamily={MONO} fontSize="20" letterSpacing="2" fill="#8b8b83">
        Made with Dev Ledger
      </text>
      <path d="M80 1844H122" stroke="#464646" strokeWidth="2" />
      <g transform={`translate(${logoX},1806)`}>
        <path
          transform="scale(1.875)"
          fill="#cfcfc7"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15
            -.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51
            -1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12
            0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82
            2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87
            3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0
            .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </g>
      <text x="1000" y="1830" textAnchor="end" fontFamily={MONO} fontSize="22" fill="#9d9d95">
        {userText}
      </text>
    </svg>
  );
}
