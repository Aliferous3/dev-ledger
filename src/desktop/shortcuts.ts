/* Desktop keyboard behavior — browser conventions users expect in a
   desktop window:

   - Ctrl/Cmd + R  → reload (F5 too)
   - Ctrl/Cmd + '+'/'-'/'0' → content zoom, persisted per install

   Zoom uses document-level CSS zoom on the root element — no native
   permissions, no webview zoom API, and every layout/visual system in the
   app scales with it since nothing sizes off window.devicePixelRatio. */

const ZOOM_KEY = 'dev-ledger:zoom';
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

function currentZoom(): number {
  const raw = Number(localStorage.getItem(ZOOM_KEY));
  return Number.isFinite(raw) && raw >= ZOOM_MIN && raw <= ZOOM_MAX ? raw : 1;
}

function applyZoom(z: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
  document.documentElement.style.zoom = String(clamped);
  localStorage.setItem(ZOOM_KEY, String(clamped));
}

export function installShortcuts(): void {
  applyZoom(currentZoom());
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'r') {
      e.preventDefault();
      window.location.reload();
      return;
    }
    if (key === '=' || key === '+') {
      e.preventDefault();
      applyZoom(currentZoom() + ZOOM_STEP);
      return;
    }
    if (key === '-') {
      e.preventDefault();
      applyZoom(currentZoom() - ZOOM_STEP);
      return;
    }
    if (key === '0') {
      e.preventDefault();
      applyZoom(1);
    }
  });
}
