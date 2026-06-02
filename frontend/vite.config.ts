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
    // In dev, proxy API calls to the Express server so there is no CORS.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
