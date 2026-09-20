import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { LoginScreen } from "./ledger/LoginScreen";
import { BootLogOverlay } from "./transitions/BootLog";

type AuthState = "loading" | "out" | "in";

function Gate() {
  const [auth, setAuth] = useState<AuthState>("loading");
  // Boot Log (POWER ON SELF TEST) plays once when the session resolves as
  // authenticated — the app mounts beneath the overlay while it is covered.
  const [booting, setBooting] = useState(false);
  const [appMounted, setAppMounted] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/user", { credentials: "same-origin" })
      .then(async (res) => {
        // Dev/static preview has no API — a non-JSON response means signed out.
        const isJson = (res.headers.get("content-type") || "").includes("json");
        const body = isJson ? await res.json().catch(() => null) : null;
        if (!live) return;
        const ok = res.ok && body?.authenticated;
        setAuth(ok ? "in" : "out");
        if (ok) setBooting(true);
      })
      .catch(() => live && setAuth("out"));
    return () => {
      live = false;
    };
  }, []);

  if (auth === "loading") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <span className="mono-tag text-[10px] text-neutral-600">
          <span className="text-[#d6ff3e]">●</span> AUTH — CHECKING SESSION
        </span>
      </div>
    );
  }
  if (auth === "out") return <LoginScreen />;
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
