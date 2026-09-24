import { useEffect, useRef, useState } from 'react';
import { ShareCard } from './ShareCard.tsx';
import {
  canCopyImage,
  copyImageBlob,
  downloadBlob,
  shareCardToPngBlob,
  sharePngFile,
} from './shareExport.ts';
import { fmtHumanRange, shareFileName, type ShareRecordData } from './shareModel.ts';

/* Share Record composer — overlay dialog, not a page. Renders the card
   preview (same SVG node the PNG export serializes) plus the three local
   actions. Accessible: labelled dialog, focus trap, Escape/backdrop
   close, scroll lock, focus restore, reduced-motion reveal. */

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ShareModal({
  record,
  onClose,
}: {
  record: ShareRecordData;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const noteTimer = useRef<number | undefined>(undefined);

  const say = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 2600);
  };

  // Dialog semantics: Escape/backdrop close, body scroll lock, focus trap,
  // focus return to the invoking control on unmount.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const prev = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    items()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = items();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(noteTimer.current);
      prev?.focus?.();
    };
  }, [onClose]);

  const renderPng = async (): Promise<Blob | null> => {
    const svg = cardRef.current;
    if (!svg) return null;
    try {
      return await shareCardToPngBlob(svg);
    } catch {
      return null;
    }
  };

  const fileName = shareFileName(record);

  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    const blob = await renderPng();
    setBusy(false);
    if (!blob) {
      say('RENDER FAILED');
      return;
    }
    const result = await sharePngFile(blob, fileName).catch(() => 'unsupported' as const);
    if (result === 'shared') say('SHARED');
    else if (result === 'cancelled') say('SHARE CANCELLED');
    else {
      // No file-capable system share — fall back to the local PNG so the
      // gesture still produces the artifact.
      downloadBlob(blob, fileName);
      say('SYSTEM SHARE UNAVAILABLE — PNG SAVED');
    }
  };

  const onCopy = async () => {
    if (busy || !canCopyImage()) return;
    setBusy(true);
    const blob = await renderPng();
    setBusy(false);
    if (!blob) {
      say('RENDER FAILED');
      return;
    }
    try {
      await copyImageBlob(blob);
      say('IMAGE COPIED');
    } catch {
      say('COPY NOT PERMITTED');
    }
  };

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    const blob = await renderPng();
    setBusy(false);
    if (!blob) {
      say('RENDER FAILED');
      return;
    }
    downloadBlob(blob, fileName);
    say('PNG SAVED');
  };

  const btnBase =
    'mono-tag text-[9px] tracking-[0.18em] px-4 py-2.5 border transition-colors w-full text-left flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/60 disabled:opacity-40 disabled:cursor-not-allowed';
  const ghostBtn = `${btnBase} border-[#3a3a3a] text-[#ccc] hover:border-[#d6ff3e] hover:text-[#d6ff3e]`;
  const copySupported = canCopyImage();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-record-title"
        className="share-modal-in w-full max-w-4xl max-h-[94vh] flex flex-col bg-[#0c0c0c] border border-neutral-800"
      >
        {/* header */}
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-neutral-800 shrink-0">
          <div
            id="share-record-title"
            className="mono-tag text-[10px] tracking-[0.22em] text-neutral-300"
          >
            SHARE RECORD <span className="text-neutral-600">//</span>{' '}
            <span className="text-[#d6ff3e]">{record.period}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share record"
            className="mono-tag text-[11px] text-neutral-500 hover:text-[#d6ff3e] border border-neutral-800 hover:border-[#d6ff3e]/60 px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/60"
          >
            ×
          </button>
        </div>

        {/* body — card preview + action column */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-5 p-4 sm:p-6 overflow-y-auto md:overflow-hidden">
          <div className="shrink-0 flex justify-center md:min-h-0 md:overflow-hidden">
            <div
              className="border border-neutral-800 bg-black shadow-2xl"
              style={{ height: 'min(72vh, 78svh)', aspectRatio: '9 / 16' }}
            >
              <ShareCard record={record} ref={cardRef} />
            </div>
          </div>

          <div className="flex flex-col gap-5 md:w-60 shrink-0 md:overflow-y-auto">
            <div>
              <div className="mono-tag text-[8px] tracking-[0.22em] text-neutral-600 mb-1.5">
                CURRENT RANGE
              </div>
              <div className="mono-tag text-[12px] text-neutral-200">{record.period}</div>
              <div className="mono-tag text-[9px] tracking-[0.14em] text-neutral-500 mt-1 leading-relaxed">
                {fmtHumanRange(record.startDate, record.endDate)}
              </div>
            </div>

            <div className="h-px bg-neutral-800" />

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onShare}
                disabled={busy}
                className={`${btnBase} border-[#d6ff3e] bg-[#d6ff3e] text-black font-bold hover:bg-[#e4ff70]`}
              >
                <span>SHARE</span>
                <span aria-hidden>↗</span>
              </button>
              {copySupported && (
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={busy}
                  className={ghostBtn}
                >
                  <span>COPY IMAGE</span>
                  <span aria-hidden>▣</span>
                </button>
              )}
              <button
                type="button"
                onClick={onDownload}
                disabled={busy}
                className={ghostBtn}
              >
                <span>DOWNLOAD PNG</span>
                <span aria-hidden>↓</span>
              </button>
            </div>

            <div
              aria-live="polite"
              className="mono-tag text-[8px] tracking-[0.18em] text-[#d6ff3e] min-h-[1em]"
            >
              {busy ? 'RENDERING…' : note}
            </div>

            <div className="mono-tag text-[7px] tracking-[0.14em] text-neutral-600 leading-relaxed mt-auto pt-4 border-t border-neutral-900">
              1080 × 1920 PNG · GENERATED LOCALLY · NO DATA LEAVES THIS BROWSER
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
