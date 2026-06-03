import path from "node:path";
import express from "express";
import { db, migrateToLatest } from "./db.js";
import { sessionMiddleware } from "./auth/session.js";
import { authRouter } from "./auth/routes.js";
import { requireSession } from "./auth/guards.js";
import type { SampleListResponse } from "./contracts.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

// Behind Coolify's TLS-terminating proxy in prod: trust the first hop so
// `secure` cookies are sent and req.protocol reflects the original https.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Sessions back the browser (BFF) auth. Mounted only on the dynamic routes so
// static asset requests never touch the session machinery or the store.
app.use(["/api", "/auth"], sessionMiddleware);

// Browser auth: /auth/login, /auth/callback, POST /auth/logout.
app.use("/auth", authRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Everything under /api/v1 is browser-facing and requires a session. (Machine
// clients get a bearer guard in step 3; this becomes "session OR bearer" then.)
app.use("/api/v1", requireSession);

app.get("/api/v1/me", (req, res) => {
  res.json({ user: req.session.user });
});

app.get("/api/v1/sample", async (_req, res) => {
  const rows = await db
    .selectFrom("sample")
    .select(["id", "name", "description", "bunny_count", "created_at"])
    .orderBy("id")
    .execute();
  const body: SampleListResponse = {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      bunnyCount: row.bunny_count,
      // Hold the Date; res.json() serializes it to an ISO-8601 string on the wire.
      createdAt: row.created_at,
    })),
  };
  res.json(body);
});

// Serve the built frontend (present in the production image).
app.use(
  express.static(path.resolve(import.meta.dirname, "../../frontend/dist"), {
    setHeaders: (res, filePath) => {
      // The SPA shell must always revalidate; hashed assets keep express's defaults.
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

async function start(): Promise<void> {
  await migrateToLatest();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });

  // Drain in-flight requests and close the DB pool on container stop / Ctrl-C.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await db.destroy();
        process.exit(0);
      });
    });
  }
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
