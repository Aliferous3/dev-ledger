/* Monochrome marks for the Share Record card — GitHub logo for the
   footer identity, and the custom cat silhouette used by the selected
   card design. Rendered as inline SVG so the exported PNG carries no
   external image dependencies. */

export function GithubMark({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15
        -.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51
        -1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12
        0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82
        2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87
        3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0
        .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/* GitHub-inspired angular cat silhouette. Inside the card it is rendered
   directly as path geometry (see ShareCard) so it can carry separate body
   fill and rim stroke — this component is the reusable inline version. */
export const CAT_BODY_PATH =
  'M60 8C33 8 12 29 12 56v32c0 4 1 8 3 11l5 15c2 4 6 8 11 10l8 1c4-1 7-4 8-8l2-12h20v14c0 3 2 5 5 5h12c3 0 5-2 5-5V82h20l2 12c1 4 4 7 8 8l8-1c5-2 9-6 11-10l5-15c2-3 3-7 3-11V56C108 29 87 8 60 8Z';
export const CAT_INNER_LEFT =
  'M26 56c-5-22 10-38 32-40l2-4c1-3-2-5-4-3-20 15-30 33-24 52';
export const CAT_INNER_RIGHT =
  'M94 56c5-22-10-38-32-40l-2-4c-1-3 2-5 4-3 20 15 30 33 24 52';

export function CatSilhouette({ size = 80, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <path d={CAT_BODY_PATH} fill={color} />
      <path d={CAT_INNER_LEFT} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <path d={CAT_INNER_RIGHT} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
