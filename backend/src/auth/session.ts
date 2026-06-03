import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db.js";

const PgStore = connectPgSimple(session);

const isProd = process.env.NODE_ENV === "production";

// In prod a real secret is mandatory; dev falls back so `npm run dev` works from
// a bare checkout. The dev value is intentionally obvious so it is never shipped.
const secret = process.env.SESSION_SECRET ?? (isProd ? undefined : "dev-insecure-session-secret");
if (!secret) {
  throw new Error("SESSION_SECRET is required (set it in the environment for production).");
}

/**
 * express-session backed by the existing Postgres pool via connect-pg-simple.
 * Cookie is httpOnly + SameSite=Lax so the browser sends it on top-level
 * navigations (needed for the OIDC redirect round-trip) but not on cross-site
 * subrequests — our first line of CSRF defense for the BFF.
 */
export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "session",
    // The table is created by migration 003; never let the store run DDL itself.
    createTableIfMissing: false,
  }),
  name: "sid",
  secret,
  // Postgres store handles its own writes; no need to resave unchanged sessions,
  // and don't persist empty sessions (so anonymous requests set no cookie/row).
  resave: false,
  saveUninitialized: false,
  // Refresh the cookie's max-age on every response so active users stay logged in.
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // requires `trust proxy` behind a TLS-terminating proxy
    path: "/",
    maxAge: 1000 * 60 * 60 * 8, // 8h idle window, refreshed per request by `rolling`
  },
});
