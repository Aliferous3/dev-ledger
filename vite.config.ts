import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Ordinary hashed assets (no single-file inlining): enables a strict
  // `script-src 'self'` CSP — no inline JavaScript needs to execute.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Dev-only demo fixtures never ship: in production builds the fixture
      // barrel resolves to an inert stub, so no demo telemetry (real or
      // fictional) enters the bundle. The store additionally gates fixture
      // rendering on import.meta.env.DEV.
      ...(command === "build"
        ? [
            {
              find: "../fixtures",
              replacement: path
                .resolve(__dirname, "src/fixtures/stub.ts")
                .replace(/\\/g, "/"),
            },
          ]
        : []),
    ],
  },
}));
