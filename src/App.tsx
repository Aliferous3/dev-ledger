import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Period } from './types';
import { IdentityContext, LedgerContext, useDashboardStore, useLedger, type Identity } from './store/live';
import { buildShareRecord } from './share/shareModel';
import { ShareModal } from './share/ShareModal';
import { useRoute, DEFAULT_PERIOD, periodFromQuery, rangeSearch, PAGES } from './pages';
import { TerminalTickerHeader } from './components/TerminalTickerHeader';
import { UtilityBar } from './components/UtilityBar';
import { SyncMonitor } from './components/SyncMonitor';
import { SyncAssist } from './components/SyncAssist';
import { TerminalCursorSyncOverlay } from './components/TerminalCursorSyncOverlay';
import { FeedbackDrawer } from './feedback/FeedbackDrawer';
import { RightSidebarNav } from './components/RightSidebarNav';
import { Section01Measure } from './components/Section01Measure';
import { Section02Field } from './components/Section02Field';
import { Section03Index } from './components/Section03Index';
import { Section04Longitudinal } from './components/Section04Longitudinal';
import { ActivityPage } from './components/ActivityPage';
import { CodePage } from './components/CodePage';
import { M12 } from './ledger/m12';

/* Three-page authenticated app — the ONLY top-level destinations are
   OVERVIEW / ACTIVITY / CODE (see src/pages.ts). The dashboard store,
   header, utility bar and the SYNC.04 monitor live above the page switch
   so data and sync state persist across navigation. Each page mounts
   fresh and its blocks apply via the M12 git-diff entrance. */

export default function App({ me = null }: { me?: Identity | null }) {
  // Default window is 90D; an explicit ?range=<preset> in the URL wins.
  const [period, setPeriodState] = useState<Period>(
    () => periodFromQuery(window.location.search) ?? DEFAULT_PERIOD,
  );
  const [crtOn, setCrtOn] = useState(false);
  const { page, navigate } = useRoute();

  // Explicit user selection is written to ?range= so refresh/back keep it;
  // the default keeps the canonical clean URL.
  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    const url = window.location.pathname + rangeSearch(p) + window.location.hash;
    history.pushState({ period: p }, '', url);
  }, []);

  // Back/forward through range entries resolves canonically (clean → 90D).
  useEffect(() => {
    const onPop = () =>
      setPeriodState(periodFromQuery(window.location.search) ?? DEFAULT_PERIOD);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Live production telemetry (or the bundled fixture when /api/dashboard is
  // unreachable — e.g. vite-only dev). `dash` is scoped to the global period
  // and shared by all three pages — no refetch on page change.
  const ledger = useDashboardStore(period);
  const netGrowth = ledger.dash.summary.sourceAdded - ledger.dash.summary.sourceDeleted;

  // SHARE — an action on the currently selected range, not a fourth page.
  // The record maps the hydrated dashboard payload + authenticated login;
  // without a resolved identity it stays null and the entry is disabled
  // (never a hardcoded or developer-credit username).
  const [shareOpen, setShareOpen] = useState(false);
  // DIAGNOSTIC DRAWER (Concept 04) — system-level feedback, mounted at the
  // app shell so context (page + range + build) is automatic.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const shareRecord = useMemo(
    () =>
      buildShareRecord({
        period,
        dash: ledger.dash,
        username:
          me?.user?.githubLogin ??
          // Dev-only fixture preview has no session — label it honestly.
          (import.meta.env.DEV && !ledger.live ? 'preview' : null),
        range: ledger.range,
        allFromIso: ledger.allFromIso,
        endIso: ledger.endIso,
      }),
    [period, ledger, me],
  );
  const totalCommits = ledger.dash.summary.commits;
  const span = ledger.all.workShape.span;
  const spanLabel = span?.firstActive && span?.lastActive
    ? `${monthYear(span.firstActive)} — ${monthYear(span.lastActive)}`
    : 'JAN 2024 — SEP 2026'; // fixture fallback

  return (
    <IdentityContext.Provider value={me}>
    <LedgerContext.Provider value={ledger}>
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col selection:bg-[#d6ff3e]/30 selection:text-white">
      {/* System utility bar: live UTC clock · CRT toggle · sync status */}
      <UtilityBar crtOn={crtOn} onToggleCrt={() => setCrtOn((v) => !v)} />

      {/* Sticky header: 3-page nav band + existing Dev Ledger marquee ticker */}
      <TerminalTickerHeader
        period={period}
        setPeriod={setPeriod}
        page={page}
        navigate={navigate}
        netGrowth={netGrowth}
        commits={totalCommits}
        onShare={() => setShareOpen(true)}
        shareDisabled={ledger.resolving || !shareRecord}
        onFeedback={() => setFeedbackOpen((v) => !v)}
        feedbackOpen={feedbackOpen}
      />

      {/* Restrained CRT scanline treatment over the application surface */}
      {crtOn && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90] scanlines-overlay crt-vignette"
        />
      )}

      {/* Right rail: within-page anchor index for the active page */}
      <RightSidebarNav page={page} />

      {/* Page content — one page mounted at a time; remount on navigation
          drives the M12 top→bottom apply. */}
      <main
        key={page}
        className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-8 md:py-16 space-y-16 md:space-y-32"
      >
        {page === 'overview' && <OverviewBody period={period} />}
        {page === 'activity' && <ActivityBody period={period} />}
        {page === 'code' && <CodeBody period={period} />}
      </main>

      {/* Bottom Footer (matching reference bottom bar "END OF RECORD").
          Phones get the compact terminal-status variant — same content,
          tighter rhythm; ≥md keeps the roomier bar. */}
      <footer className="border-t border-neutral-900 bg-black/60 py-3 md:py-6 px-4 sm:px-6 md:px-12 text-[10px] mono-tag text-neutral-500 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 md:gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-neutral-400">END OF RECORD</span>
          <span className="text-neutral-700">·</span>
          <span>LONGITUDINAL TELEMETRY [{spanLabel}]</span>
        </div>

        {/* Right cluster keeps ~56px clearance on phones so the collapsed
            SYNC.MON pip (fixed bottom-right) can never cover footer links. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 md:gap-4 max-sm:pr-14">
          <a
            href="/security"
            className="text-neutral-500 hover:text-neutral-200 focus-visible:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/40 transition-colors"
          >
            SECURITY &amp; PRIVACY
          </a>
          <span className="text-neutral-700">|</span>
          <span className="text-neutral-600">DEV LEDGER / CODE METRICS · v1.3.0</span>
          <span className="text-neutral-700">|</span>
          <span className="flex items-center gap-2 text-[#d6ff3e]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d6ff3e] pulse-dot" />
            STREAM ACTIVE
          </span>
        </div>
      </footer>

      {/* SHARE RECORD composer — overlay only; no route, no server call */}
      {shareOpen && shareRecord && (
        <ShareModal record={shareRecord} onClose={() => setShareOpen(false)} />
      )}

      {/* SYSTEM DRAWER — feedback; CONTEXT // AUTOMATIC is reported, not asked */}
      <FeedbackDrawer
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        context={{
          page: PAGES.find((p) => p.id === page)?.name ?? 'OVERVIEW',
          range: period,
          build: 'V1.3.0',
        }}
      />

      {/* S10 TERMINAL CURSOR — full-width write head driven by the same
          canonical sync state as SYNC.MON. Purely visual; controls stay usable. */}
      <TerminalCursorSyncOverlay />

      {/* SYNC.04 system monitor — app-level, persists across all pages */}
      <SyncMonitor />
      {/* SYNC.ASSIST — zero-metrics prompt, anchored above the monitor */}
      <SyncAssist />
    </div>
    </LedgerContext.Provider>
    </IdentityContext.Provider>
  );
}

/* OVERVIEW — app start through the LONGITUDINAL RECORD, inclusive. */
function OverviewBody({ period }: { period: Period }) {
  const ledger = useLedger();
  return (
    <>
      <M12 i={0}><Section01Measure period={period} daysData={ledger.days} /></M12>
      <M12 i={4}><Section02Field period={period} /></M12>
      <M12 i={8}><Section03Index period={period} /></M12>
      <M12 i={12}><Section04Longitudinal period={period} /></M12>
    </>
  );
}

/* ACTIVITY — the Activity record, up to (not including) Source Composition. */
function ActivityBody({ period }: { period: Period }) {
  return <ActivityPage period={period} />;
}

/* CODE — Source Composition through end of record. */
function CodeBody({ period }: { period: Period }) {
  return <CodePage period={period} />;
}

const MONTH_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function monthYear(iso: string) {
  return `${MONTH_SHORT[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}`;
}
