import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DESCRIPTION_MAX,
  FEEDBACK_TYPES,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MIMES,
  TITLE_MAX,
} from './feedbackModel.mjs';

/* SYSTEM DRAWER — feedback, per the canonical Concept 04 design
   (PROGRESSIVE EXPANSION): a 320px diagnostic drawer off the right edge on
   desktop, a full-screen progressive form on phones. Opens showing only
   TYPE + TITLE; `+ ADD DESCRIPTION / SCREENSHOT / CONTEXT` reveals the
   rest. TRANSMIT posts to the real /api/feedback endpoint — no mock. */

const LIME = '#d6ff3e';
const INK = '#e9e9e6';
const ZINC = '#999';
const DIM = '#555';
const FAINT = '#333';
const HAIR = '#1c1c1c';
const PANEL = '#0e0e0e';
const CLAY = '#c08379';

export interface FeedbackContext {
  page: string;
  range: string;
  build: string;
}

interface Shot {
  name: string;
  mime: string;
  data: string;
  bytes: number;
}

type DrawerState = 'form' | 'sending' | 'success' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  context: FeedbackContext;
}

export function FeedbackDrawer({ open, onClose, context }: Props) {
  const [state, setState] = useState<DrawerState>('form');
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<(typeof FEEDBACK_TYPES)[number]>('BUG');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shot, setShot] = useState<Shot | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setState('form');
    setExpanded(false);
    setType('BUG');
    setTitle('');
    setDescription('');
    setShot(null);
    setFieldError(null);
  }, []);

  const close = useCallback(() => {
    onClose();
    // Let the exit settle before clearing — a visible reset mid-close reads
    // as a glitch; the panel unmounts on the next frame anyway.
    setTimeout(reset, 200);
  }, [onClose, reset]);

  // ESC closes from anywhere while the drawer is open; opening focuses the
  // first field (keyboard-first, per the concept).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    titleRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const attach = (file: File | null) => {
    if (!file) return;
    if (!SCREENSHOT_MIMES.includes(file.type)) {
      setFieldError('SCREENSHOT MUST BE PNG, JPEG, OR WEBP');
      return;
    }
    if (file.size > SCREENSHOT_MAX_BYTES) {
      setFieldError('SCREENSHOT EXCEEDS 1 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      const data = url.slice(url.indexOf(',') + 1);
      setShot({ name: file.name, mime: file.type, data, bytes: file.size });
      setFieldError(null);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!title.trim()) {
      setFieldError('TITLE REQUIRED');
      titleRef.current?.focus();
      return;
    }
    setFieldError(null);
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          description,
          page: context.page,
          range: context.range,
          build: context.build,
          screenshot: shot ? { name: shot.name, mime: shot.mime, data: shot.data } : undefined,
        }),
      });
      setState(res.ok ? 'success' : 'error');
    } catch {
      setState('error');
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Diagnostic drawer"
      aria-modal="false"
      className="fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[320px] z-[95] border-l overflow-y-auto overscroll-contain drawer-in"
      style={{ borderColor: LIME, background: PANEL }}
    >
      {(state === 'form' || state === 'sending') && (
        <div className="p-5 sm:p-4 space-y-3 flex flex-col min-h-full sm:min-h-0">
          <div className="flex items-center justify-between">
            <span className="mono-tag text-[8px] tracking-[0.22em]" style={{ color: LIME }}>
              DIAGNOSTIC DRAWER
            </span>
            <button
              type="button"
              onClick={close}
              className="mono-tag text-[8px] transition-colors hover:text-[#e9e9e6]"
              style={{ color: DIM }}
            >
              ESC
            </button>
          </div>

          {/* TYPE — lime-outline pill selector */}
          <div className="flex gap-1.5" role="radiogroup" aria-label="Feedback type">
            {FEEDBACK_TYPES.map((t) => {
              const on = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setType(t)}
                  className="mono-tag text-[8px] px-2.5 py-1 border transition-all"
                  style={{
                    borderColor: on ? LIME : '#2a2a2a',
                    color: on ? LIME : DIM,
                    background: on ? 'rgba(214,255,62,.08)' : 'transparent',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>

          {/* TITLE — prompt field */}
          <div>
            <label
              htmlFor="fb-title"
              className="mono-tag text-[8px] flex items-center gap-1"
              style={{ color: DIM }}
            >
              <span style={{ color: LIME }}>&gt;</span> TITLE
            </label>
            <input
              id="fb-title"
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => {
                setTitle(e.target.value);
                if (fieldError === 'TITLE REQUIRED') setFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!expanded) setExpanded(true);
                  else submit();
                }
              }}
              placeholder="SHORT SUMMARY OF THE SIGNAL"
              className="w-full bg-transparent border-b mt-1 pb-1 mono-tag text-[10px] outline-none placeholder:text-neutral-700 focus:border-[#d6ff3e]/60 transition-colors"
              style={{ borderColor: fieldError ? CLAY : HAIR, color: INK }}
            />
          </div>

          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mono-tag text-[7px] w-full text-left transition-colors hover:text-[#e9e9e6]"
              style={{ color: DIM }}
            >
              <span style={{ color: LIME }}>+</span> ADD DESCRIPTION / SCREENSHOT / CONTEXT
            </button>
          )}

          {expanded && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="fb-desc"
                  className="mono-tag text-[8px] flex items-center gap-1"
                  style={{ color: DIM }}
                >
                  <span style={{ color: LIME }}>&gt;</span> DESCRIPTION
                </label>
                <textarea
                  id="fb-desc"
                  value={description}
                  maxLength={DESCRIPTION_MAX}
                  rows={4}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="WHAT HAPPENED, WHAT YOU EXPECTED"
                  className="w-full bg-transparent border-b mt-1 pb-1 mono-tag text-[10px] outline-none resize-y placeholder:text-neutral-700 focus:border-[#d6ff3e]/60 transition-colors"
                  style={{ borderColor: HAIR, color: INK }}
                />
              </div>

              {/* screenshot — real optional attachment */}
              {shot ? (
                <div
                  className="flex items-center gap-2 border px-2 py-1.5"
                  style={{ borderColor: HAIR, background: '#0b0b0b' }}
                >
                  <span
                    className="w-8 h-6 border flex items-center justify-center mono-tag text-[6px] shrink-0"
                    style={{ borderColor: FAINT, background: '#111', color: FAINT }}
                  >
                    IMG
                  </span>
                  <span className="mono-tag text-[7px] flex-1 truncate" style={{ color: ZINC }}>
                    {shot.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShot(null)}
                    aria-label="remove screenshot"
                    className="mono-tag text-[8px] transition-colors hover:text-[#e9e9e6]"
                    style={{ color: DIM }}
                  >
                    [×]
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mono-tag text-[7px] px-2 py-1 border transition-colors hover:border-[#d6ff3e]/50 hover:text-[#e9e9e6]"
                  style={{ borderColor: HAIR, color: DIM }}
                >
                  + ATTACH SCREENSHOT · OPTIONAL · PNG/JPG/WEBP ≤1MB
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={SCREENSHOT_MIMES.join(',')}
                className="hidden"
                onChange={(e) => {
                  attach(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />

              {/* CONTEXT // AUTOMATIC — reported, never asked */}
              <div className="border p-2" style={{ borderColor: HAIR }}>
                <div className="mono-tag text-[7px] mb-1" style={{ color: DIM }}>
                  CONTEXT // AUTOMATIC
                </div>
                <div className="mono-tag text-[7px]" style={{ color: ZINC }}>
                  {context.page} · {context.range} · {context.build}
                </div>
              </div>
            </div>
          )}

          {fieldError && (
            <div className="mono-tag text-[8px]" role="alert" style={{ color: CLAY }}>
              {fieldError}
            </div>
          )}

          <div
            className="flex items-center justify-between pt-2 border-t mt-auto sm:mt-0"
            style={{ borderColor: HAIR }}
          >
            <span className="mono-tag text-[7px]" style={{ color: FAINT }}>
              {expanded ? (shot ? '3 FIELDS · 1 ATTACHMENT' : '3 FIELDS') : '1 FIELD'}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={state === 'sending'}
              className="mono-tag text-[8px] px-3 py-1.5 border transition-all hover:bg-[#d6ff3e]/10 disabled:opacity-50"
              style={{ borderColor: LIME, color: LIME }}
            >
              {state === 'sending' ? 'TRANSMITTING…' : 'TRANSMIT'}
            </button>
          </div>
        </div>
      )}

      {state === 'success' && (
        <div className="p-6 text-center space-y-3" aria-live="polite">
          <div className="font-editorial font-light text-lg" style={{ color: LIME }}>
            TRANSMISSION COMPLETE
          </div>
          <div className="mono-tag text-[8px]" style={{ color: ZINC }}>
            SIGNAL RECEIVED
          </div>
          <button
            type="button"
            onClick={close}
            className="mono-tag text-[7px] mt-3 transition-colors hover:text-[#e9e9e6]"
            style={{ color: DIM }}
          >
            [ CLOSE ]
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="p-6 text-center space-y-3" aria-live="assertive">
          <div className="font-editorial font-light text-base" style={{ color: CLAY }}>
            TRANSMISSION FAILED
          </div>
          <div className="mono-tag text-[8px]" style={{ color: ZINC }}>
            SIGNAL LOST
          </div>
          <button
            type="button"
            onClick={() => setState('form')}
            className="mono-tag text-[8px] px-3 py-1.5 border transition-colors"
            style={{ borderColor: CLAY, color: CLAY }}
          >
            [RETRY]
          </button>
        </div>
      )}
    </div>
  );
}
