import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Frontend imports the API contract straight from the backend (type-only).
      "@contracts": fileURLToPath(
        new URL("../backend/src/contracts.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // In dev, proxy API + auth calls to Express so the browser stays on one
    // origin (:5173) — needed for the cookie-based BFF login to work with HMR.
    // changeOrigin stays false so Express sees Host: localhost:5173 and builds
    // the right redirect_uri / cookie scope.
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
