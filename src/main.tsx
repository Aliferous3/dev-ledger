import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
// Self-hosted typefaces (OFL-licensed via Fontsource) — replaces the previous
// Google Fonts request so production never contacts fonts.g* APIs/CDNs.
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-300.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400-italic.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./index.css";
import App from "./App";
import { initAnalytics } from "./analytics/posthog";
import { SecurityPrivacyPage } from "./security/SecurityPrivacyPage";
import { PrivacyPolicyPage } from "./legal/PrivacyPolicyPage";
import { TermsOfServicePage } from "./legal/TermsOfServicePage";
import { LoginScreen } from "./ledger/LoginScreen";
import { BootLogOverlay, BootLogPreloader } from "./transitions/BootLog";
import type { Identity } from "./store/live";

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_URL,
  heartbeatOutcome,
  shouldHeartbeat,
} from "./ledger/heartbeatModel.mjs";

type AuthState = "loading" | "out" | "in";

function Gate() {
  const [auth, setAuth] = useState<AuthState>("loading");
  // Boot Log (POWER ON SELF TEST) plays once when the session resolves as
  // authenticated — the app mounts beneath the overlay while it is covered.
  const [booting, setBooting] = useState(false);
  const [appMounted, setAppMounted] = useState(false);
  // True once /api/user answers — i.e. a real backend is serving (vercel dev
  // / production), so the DEV preview bypass must stay off. A real backend
  // always answers JSON; the only non-JSON 200 is the vite static fallback,
  // and a non-JSON error still proves an API exists.
  const [apiPresent, setApiPresent] = useState(false);
  // Whether the authenticated session is remembered ("keep me signed in").
  // Drives the inactivity heartbeat gate — persistent sessions carry no lease.
  const [persistent, setPersistent] = useState(false);
  // The authenticated identity payload — safe presentation data only
  // (login, avatar, installations, sync). Feeds App via IdentityContext.
  const [me, setMe] = useState<Identity | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/user", { credentials: "same-origin" })
      .then(async (res) => {
        // A real backend always answers /api/user with JSON. The only
        // non-JSON 200 is the vite static fallback (no API → preview bypass
        // is allowed). A non-JSON error still proves an API exists.
        const isJson = (res.headers.get("content-type") || "").includes("json");
        const body = isJson ? await res.json().catch(() => null) : null;
        if (!live) return;
        setApiPresent(isJson || res.status !== 200);
        const ok = res.ok && body?.authenticated;
        setPersistent(body?.persistent === true);
        setMe(ok ? (body as Identity) : null);
        setAuth(ok ? "in" : "out");
        if (ok) setBooting(true);
      })
      .catch(() => live && setAuth("out"));
    return () => {
      live = false;
    };
  }, []);

  // Inactivity heartbeat: while authenticated WITHOUT "keep me signed in",
  // renew the server-side lease every 60s (plus immediately on focus/visible
  // — covers background-tab throttling). Any open tab keeps the lease alive;
  // when all tabs close the beats stop and the lease expires server-side.
  // A 401 means the lease lapsed (sleep/offline > lease) → logged out.
  useEffect(() => {
    if (auth !== "in" || !shouldHeartbeat({ authenticated: true, persistent })) {
      return;
    }
    let dead = false;
    const beat = () => {
      fetch(HEARTBEAT_URL, { method: "POST", credentials: "same-origin" })
        .then((res) => {
          if (!dead && heartbeatOutcome(res.status) === "logout") {
            setPersistent(false);
            setMe(null);
            setAuth("out");
          }
        })
        .catch(() => {});
    };
    const onWake = () => {
      if (document.visibilityState !== "hidden") beat();
    };
    const t = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      dead = true;
      clearInterval(t);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [auth, persistent]);

  if (auth === "loading") {
    return <BootLogPreloader label="auth · checking session" />;
  }
  if (auth === "out") {
    return (
      <LoginScreen
        onLogin={import.meta.env.DEV && !apiPresent ? () => {
          // API-less dev preview: present a clearly synthetic identity so
          // surfaces that read IdentityContext (account menu, share record)
          // render the real UI instead of the no-session placeholder.
          setMe({
            authenticated: true,
            user: { githubLogin: "octo-demo" },
            installations: [],
            appSlug: null,
            sync: null,
          });
          // Persistent preview session — suppresses the 60s lease heartbeat
          // against a backend that doesn't exist here.
          setPersistent(true);
          setAuth("in");
          setBooting(true);
        } : undefined}
      />
    );
  }
  return (
    <>
      {appMounted && <App me={me} />}
      <BootLogOverlay
        active={booting}
        label="code metrics · v1.3.0"
        onCovered={() => setAppMounted(true)}
        onDone={() => setBooting(false)}
      />
    </>
  );
}

/* Public legal/trust routes sit ABOVE the authenticated Gate. They render
   without touching /api/user, so the Privacy Policy, Terms of Service and
   technical trust record remain available before sign-in. The authenticated
   PAGES registry is untouched: OVERVIEW / ACTIVITY / CODE remain the only
   product destinations. */
function Root() {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  if (p === "/privacy") return <PrivacyPolicyPage />;
  if (p === "/terms") return <TermsOfServicePage />;
  if (p === "/security") return <SecurityPrivacyPage />;
  return <Gate />;
}

// PostHog product analytics — initialized once at boot. Lazy-loaded and
// no-ops without a configured token; sends only allowlisted custom events
// through the same-origin /rly proxy.
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
    {/* Vercel Web Analytics — one instance at the true root so it covers
        /security, /privacy, the login gate, and every authenticated page.
        Same-origin /_vercel/insights/* — fits the existing CSP. */}
    <Analytics />
    {/* Vercel Speed Insights — captures real-user Core Web Vitals in production. */}
    <SpeedInsights />
  </StrictMode>
);
