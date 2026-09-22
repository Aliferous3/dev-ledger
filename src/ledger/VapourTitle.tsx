import { useEffect, useRef, useState } from 'react';

/* VAPOUR TITLE — canvas particle coalescence for the login DEV LEDGER
   title only. One shot, ~5.5s total:

     P1 DISPERSE (0–1.4s)   particles fade in scattered around the glyph
                            field, drifting gently — vapour gathering
     P2 CONVERGE (1.4–5.2s) particles ease onto their sampled glyph
                            pixels; letterforms become legible late in
                            the phase
     P3 RESOLVE (5.2–5.55s) canvas crossfades into the real <h1>, RAF
                            stops, canvas unmounts — static title

   The h1 stays in the DOM (and the accessibility tree) the whole time:
   visually transparent during the vapour pass, then fully resolved.
   prefers-reduced-motion → no canvas work at all, title shown directly. */

const DISPERSE_MS = 1400;
const CONVERGE_MS = 3800;
const SETTLE_MS = 350;
export const VAPOUR_TOTAL_MS = DISPERSE_MS + CONVERGE_MS + SETTLE_MS;

export function VapourTitle({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [resolved, setResolved] = useState(reduced);
  // While particles coalesce the real title is transparent but present.
  const [vapouring, setVapouring] = useState(!reduced);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const h1 = h1Ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !h1 || !wrap) return;

    let raf = 0;
    let dead = false;
    let particles: {
      sx: number; sy: number;   // scattered origin (device px)
      tx: number; ty: number;   // glyph target (device px)
      d: number;                // per-particle convergence delay
      ph: number;               // drift phase offset
    }[] = [];
    let t0 = 0;

    const build = () => {
      const rect = h1.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // Canvas is oversized vs the h1 box so the disperse phase is visible:
      // particles gather in the field AROUND the glyph area, not clipped
      // at its edges. Glyph targets sit centered inside the field.
      const padX = rect.width * 0.45;
      const padY = rect.height * 1.4;
      const cw = rect.width + padX * 2;
      const ch = rect.height + padY * 2;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      // Sample the title's real glyph pixels offscreen — centered in the
      // padded field so sx/sy can scatter across the whole canvas.
      const cs = getComputedStyle(h1);
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext('2d');
      if (!octx) return false;
      octx.scale(dpr, dpr);
      octx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle = '#fff';
      octx.fillText(text, cw / 2, ch / 2);

      const img = octx.getImageData(0, 0, canvas.width, canvas.height).data;
      const step = Math.max(2, Math.round(3 * dpr));
      particles = [];
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          if (img[(y * canvas.width + x) * 4 + 3] > 128) {
            particles.push({
              sx: x + (Math.random() - 0.5) * cw * dpr * 0.8,
              sy: y + (Math.random() - 0.5) * ch * dpr * 0.8,
              tx: x,
              ty: y,
              d: Math.random() * 0.3,
              ph: Math.random() * Math.PI * 2,
            });
          }
        }
      }
      return particles.length > 0;
    };

    const frame = (now: number) => {
      if (dead) return;
      if (!t0) t0 = now;
      const el = now - t0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e9e9e6';

      if (el < DISPERSE_MS) {
        // P1 — vapour gathering: gentle drift + fade-in, no convergence.
        const t = el / DISPERSE_MS;
        for (const p of particles) {
          const wob = 6 * (1 - t * 0.5);
          const x = p.sx + Math.sin(now * 0.0008 + p.ph) * wob;
          const y = p.sy + Math.cos(now * 0.0006 + p.ph * 1.3) * wob * 0.7;
          ctx.globalAlpha = 0.05 + t * 0.3;
          ctx.fillRect(x, y, 1.6, 1.6);
        }
      } else {
        // P2 — convergence: per-particle delayed ease onto glyph pixels.
        // Late-phase alpha approaches 1 so letterforms read before the
        // crossfade into the real title.
        const t = Math.min(1, (el - DISPERSE_MS) / CONVERGE_MS);
        const ease = 1 - Math.pow(1 - t, 3);
        for (const p of particles) {
          const k = Math.max(0, Math.min(1, (ease - p.d) / (1 - p.d)));
          const wob = 4 * (1 - k);
          const x = p.sx + (p.tx - p.sx) * k + Math.sin(now * 0.001 + p.ph) * wob;
          const y = p.sy + (p.ty - p.sy) * k + Math.cos(now * 0.0008 + p.ph * 1.3) * wob * 0.7;
          ctx.globalAlpha = 0.3 + k * 0.7;
          ctx.fillRect(x, y, 1.6, 1.6);
        }
      }
      ctx.globalAlpha = 1;

      if (el < DISPERSE_MS + CONVERGE_MS) {
        raf = requestAnimationFrame(frame);
      } else {
        // Coalesced — hand off to the real title and stop the simulation.
        setVapouring(false);
        window.setTimeout(() => {
          if (!dead) setResolved(true);
        }, SETTLE_MS);
      }
    };

    const start = () => {
      if (build()) raf = requestAnimationFrame(frame);
      else {
        // Sampling failed (font not ready etc.) — show the title plainly.
        setVapouring(false);
        setResolved(true);
      }
    };
    if (document.fonts?.ready) document.fonts.ready.then(start);
    else start();

    const onResize = () => {
      if (t0 === 0) build(); // only re-sample while still converging
    };
    window.addEventListener('resize', onResize);
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [reduced, text]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <h1
        ref={h1Ref}
        className={className}
        style={{ opacity: vapouring ? 0 : 1, transition: 'opacity 0.35s ease-out' }}
      >
        {text}
      </h1>
      {!resolved && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        />
      )}
    </div>
  );
}
