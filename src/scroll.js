import Lenis from 'lenis'

/* Global inertial smooth scroll. One Lenis instance + one RAF loop for the
   whole app. Disabled under prefers-reduced-motion and on coarse-pointer
   (touch) devices, where native scrolling is preferred. */

let lenis = null
let rafId = null
let mediaCleanup = null

export function smoothScrollEnabled({
  reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  coarse = globalThis.matchMedia?.('(pointer: coarse)').matches,
} = {}) {
  return Boolean(!reduced && !coarse)
}

export function initSmoothScroll() {
  if (lenis || typeof window === 'undefined' || !smoothScrollEnabled()) return lenis ?? null
  lenis = new Lenis({
    duration: 1.05,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1,
  })
  const raf = (time) => {
    lenis?.raf(time)
    rafId = requestAnimationFrame(raf)
  }
  rafId = requestAnimationFrame(raf)
  window.__lenis = lenis

  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onChange = (e) => { if (e.matches) destroySmoothScroll() }
  reducedMq.addEventListener('change', onChange)
  mediaCleanup = () => reducedMq.removeEventListener('change', onChange)
  return lenis
}

export function destroySmoothScroll() {
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = null
  mediaCleanup?.()
  mediaCleanup = null
  if (lenis) {
    lenis.destroy()
    lenis = null
  }
}

export function scrollToTop(immediate = true) {
  if (lenis) lenis.scrollTo(0, { immediate, force: true })
  else if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
}
