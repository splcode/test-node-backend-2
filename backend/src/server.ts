import path from "node:path";
import express from "express";
import { db, migrateToLatest } from "./db.js";
import { sessionMiddleware } from "./auth/session.js";
import { authRouter } from "./auth/routes.js";
import { backchannelLogout } from "./auth/backchannel.js";
import { requireSessionOrBearer } from "./auth/bearer.js";
import { issueCsrfToken, requireCsrf } from "./auth/csrf.js";
import { mapClaimsToUser } from "./auth/oidc.js";
import type { SampleListResponse, MeResponse } from "./contracts.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

// Behind Coolify's TLS-terminating proxy in prod: trust the first hop so
// `secure` cookies are sent and req.protocol reflects the original https.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// OIDC Back-Channel Logout: Keycloak POSTs a signed logout_token here (server to
// server, x-www-form-urlencoded) when an SSO session ends elsewhere. It carries no
// session cookie or XSRF token, so it's mounted ahead of the session + CSRF
// middleware with its own body parser, and validates the token itself.
app.post("/auth/backchannel-logout", express.urlencoded({ extended: false }), backchannelLogout);

// Sessions back the browser (BFF) auth. Mounted only on the dynamic routes so
// static asset requests never touch the session machinery or the store.
app.use(["/api", "/auth"], sessionMiddleware);

// Double-submit CSRF: hand the client a readable XSRF-TOKEN cookie, then require
// a matching X-XSRF-TOKEN header on every state-changing request.
app.use(["/api", "/auth"], issueCsrfToken);
app.use(["/api", "/auth"], requireCsrf);

// Browser auth: /auth/login, /auth/callback, POST /auth/logout.
app.use("/auth", authRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Everything under /api/v1 requires a browser session OR a valid bearer token
// (machine clients). The guard sets req.session.user or req.bearer accordingly.
app.use("/api/v1", requireSessionOrBearer);

app.get("/api/v1/me", (req, res) => {
  // The guard admits either a browser session or a bearer token, so surface
  // whichever authenticated — not just the session. For a bearer token the access
  // token already carries identity/orgs/realm roles (incl. a confidential client's
  // service-account user), so reuse the same claims mapper.
  let body: MeResponse;
  if (req.session.user) {
    body = { user: req.session.user, via: "session" };
  } else if (req.bearer) {
    const claims = req.bearer.claims as Record<string, unknown>;
    body = { user: mapClaimsToUser(claims, claims), via: "bearer", client: req.bearer.clientId };
  } else {
    body = { user: null };
  }
  res.json(body);
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
