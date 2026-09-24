import { SHARE_CARD } from './shareModel.ts';

/* Client-side Share Record export — everything happens in the user's
   browser. The rendered SVG card is serialized, its self-hosted fonts are
   inlined as data URIs (SVG-as-image cannot reach document fonts), then
   rasterized through a canvas at exactly 1080×1920. No server round-trip,
   no third-party service, no DOM-capture dependency. */

const FAMILIES = ['JetBrains Mono'];

let fontCssCache: Promise<string> | null = null;

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/* Inline the document's @font-face rules for the card's typefaces with
   their woff2 payloads embedded as data URIs. Same-origin Fontsource
   assets only — failures degrade to the generic mono fallback rather
   than aborting the export. */
async function embeddedFontCss(): Promise<string> {
  const css: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — not ours
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const text = rule.cssText;
      if (!FAMILIES.some((f) => text.includes(f))) continue;
      let out = text;
      const src = rule.style.getPropertyValue('src') || '';
      const urls = [...src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)];
      for (const m of urls) {
        try {
          const res = await fetch(m[2], { credentials: 'same-origin' });
          if (!res.ok) continue;
          const b64 = abToB64(await res.arrayBuffer());
          const ext = (m[2].split('?')[0].split('.').pop() || '').toLowerCase();
          const mime =
            ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'font/truetype';
          out = out.replace(m[0], `url(data:${mime};base64,${b64})`);
        } catch {
          /* keep the original src for that face */
        }
      }
      css.push(out);
    }
  }
  return css.join('\n');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg rasterize failed'));
    img.src = src;
  });
}

/* Serialize the live card node → embed fonts → rasterize at the exact
   export contract size. The preview and the PNG share one source, so
   they cannot drift. */
export async function shareCardToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  try {
    await document.fonts.ready;
  } catch {
    /* fonts API absent — embed pass still attempts src inlining */
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(SHARE_CARD.width));
  clone.setAttribute('height', String(SHARE_CARD.height));

  const fontCss = await (fontCssCache ??= embeddedFontCss());
  if (fontCss) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }

  const svgText = new XMLSerializer().serializeToString(clone);
  const url = await blobToDataUrl(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const img = await loadImage(url);

  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD.width;
  canvas.height = SHARE_CARD.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, SHARE_CARD.width, SHARE_CARD.height);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('png encode failed'))),
      'image/png',
    ),
  );
}

/* Always-available local action. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Image clipboard support varies by engine — callers gate on this. */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  if (!canCopyImage()) throw new Error('image clipboard unsupported');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/* Native file sharing (mobile/modern desktop where implemented). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/* Native file sharing (mobile/modern desktop where implemented). The
   caller hands over a pre-built File so the transient user activation on
   the SHARE click is still live when navigator.share() runs — no async
   rendering happens between the gesture and this call. */
/** 'shared' · 'cancelled' · 'unsupported' */
export async function sharePngFile(
  file: File,
): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFile(file)) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: 'Dev Ledger Share Record' });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
