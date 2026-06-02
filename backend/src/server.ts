import path from "node:path";
import fs from "node:fs";
import express from "express";
import { listSamples } from "./samples";
import { migrateToLatest } from "./db/migrator";
import type { SampleListResponse } from "./contracts";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0"; // bind all interfaces so Coolify's proxy can reach us

const app = express();

app.use(express.json());

// --- API ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/v1/sample", async (_req, res, next) => {
  try {
    const data = await listSamples();
    const body: SampleListResponse = { data };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// Any other /api/* path -> JSON 404 (never serve index.html for the API).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// --- Static frontend (present in the production image) ---
const frontendDist = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(
    express.static(frontendDist, {
      index: false, // we serve index.html ourselves so it is always revalidated
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Vite-hashed filenames are content-addressed -> cache forever.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          // Unhashed root files (favicon, etc.) -> always revalidate.
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // index fallback for non-API, non-asset routes (always revalidated).
  app.use((req, res) => {
    // Don't return index.html for a missing asset file -> avoids MIME errors.
    if (req.path.startsWith("/assets/") || path.extname(req.path)) {
      res.status(404).type("txt").send("Not found");
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// --- Error handler (last) ---
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

async function start(): Promise<void> {
  // Auto-migrate on boot (Flyway-style): idempotent + lock-guarded.
  await migrateToLatest();
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
