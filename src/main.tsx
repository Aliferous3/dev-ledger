import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { LoginScreen } from "./ledger/LoginScreen";

type AuthState = "loading" | "out" | "in";

function Gate() {
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/user", { credentials: "same-origin" })
      .then(async (res) => {
        // Dev/static preview has no API — a non-JSON response means signed out.
        const isJson = (res.headers.get("content-type") || "").includes("json");
        const body = isJson ? await res.json().catch(() => null) : null;
        if (live) setAuth(res.ok && body?.authenticated ? "in" : "out");
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
  return auth === "in" ? <App /> : <LoginScreen />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>
);
