import type { CSSProperties, ReactNode, Ref } from 'react';
import { createElement } from 'react';

/* M12 · GIT DIFF · +/- GUTTER — the app's primary entrance language.

   One shared IntersectionObserver watches every .m12 element; the first
   time it intersects, .m12-on is added and the element plays the
   `diff-apply` keyframes once (transient "+" gutter, lime tint, left rule —
   see index.css). No per-row React state: the stagger is pure
   animation-delay, and the observer disconnects per element after firing.

   Semantics (from the M12 reference):
   - lines apply top→bottom at ~34ms stagger
   - "+" is transitional — it fades with the tint, never permanent
   - live value changes must NOT retrigger the entrance (fire once)
   - prefers-reduced-motion: the global media query collapses the
     animation to ~0ms, so content simply appears. */

export const M12_STAGGER_MS = 34;

type ObservedEl = HTMLElement & { __m12On?: boolean };

let io: IntersectionObserver | null = null;
function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as ObservedEl;
          if (el.__m12On) continue;
          el.__m12On = true;
          el.classList.remove('m12-wait');
          el.classList.add(el.dataset.m12On || 'm12-on');
          io!.unobserve(el);
        }
      },
      { threshold: 0.08 },
    );
  }
  return io;
}

/* Callback ref (React 19 supports ref cleanup): registers the element with
   the shared observer and arms it so it stays hidden until revealed. When
   IntersectionObserver is unavailable the element is left visible.
   `onClass` selects the applied animation — 'm12-on' (gutter "+" + tint)
   or 'm12-cell-on' (tint only, for dense matrices like the heatmap). */
export function registerM12(
  el: HTMLElement | null,
  onClass = 'm12-on',
): void | (() => void) {
  if (!el) return;
  const o = observer();
  if (!o) return;
  el.classList.add('m12-wait');
  el.dataset.m12On = onClass;
  o.observe(el);
  return () => {
    o.unobserve(el);
    el.classList.remove('m12-wait');
  };
}

/* Ref for dense grids: <div ref={m12CellRef} …> — cells apply like added
   hunks with tint only (no "+" at cell scale). Stagger via style. */
export function m12CellRef(el: HTMLElement | null) {
  return registerM12(el, 'm12-cell-on');
}

/* Stagger delay for element i in document order — 34ms per the M12 spec. */
export function m12Delay(i: number): CSSProperties {
  return { animationDelay: `${i * M12_STAGGER_MS}ms` };
}

/* Wrapper for block-level entrances: <M12 i={2}>…</M12>. For elements that
   can't take a wrapper (table rows etc.) apply className="m12" +
   ref={registerM12} + style={m12Delay(i)} directly. */
export function M12({
  i = 0,
  as = 'div',
  className = '',
  style,
  children,
  ...rest
}: {
  i?: number;
  as?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [k: string]: unknown;
}) {
  return createElement(as, {
    ref: registerM12 as Ref<HTMLElement>,
    className: `m12 ${className}`.trim(),
    style: { ...m12Delay(i), ...style },
    ...rest,
  }, children);
}
