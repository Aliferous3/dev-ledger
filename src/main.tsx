import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { LoginScreen } from "./ledger/LoginScreen";
import { BootLogOverlay, BootLogPreloader } from "./transitions/BootLog";

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
          setAuth("in");
          setBooting(true);
        } : undefined}
      />
    );
  }
  return (
    <>
      {appMounted && <App />}
      <BootLogOverlay
        active={booting}
        label="code metrics · v1.3.0"
        onCovered={() => setAppMounted(true)}
        onDone={() => setBooting(false)}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>
);
