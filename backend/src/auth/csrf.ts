import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { hasBearer } from "./bearer.js";

/**
 * Double-submit CSRF, the Angular/Axios/Spring-style convention: a readable
 * `XSRF-TOKEN` cookie carries a token the client echoes back in the
 * `X-XSRF-TOKEN` header on every state-changing request.
 *
 * This is the *session-backed* variant: the token's source of truth is the
 * server-side session, and `requireCsrf` compares the header to the session
 * value (not to the cookie). So even an attacker who can overwrite the cookie
 * (e.g. from a sibling subdomain) can't forge a request — they'd need the token
 * value held in the session, which they can't read. The cookie is just transport.
 */
export const CSRF_COOKIE = "XSRF-TOKEN";
export const CSRF_HEADER = "x-xsrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const isProd = process.env.NODE_ENV === "production";

/** Minimal cookie reader so we don't pull in cookie-parser just for this. */
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; a differing length is a non-match.
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Ensure the session has a CSRF token and the client holds it in a readable
 * cookie. Runs on every request to the protected mounts; re-issues the cookie
 * whenever it's missing or stale so the client and session stay in sync.
 */
export function issueCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const session = req.session;
  if (session) {
    if (!session.csrfToken) {
      session.csrfToken = crypto.randomBytes(32).toString("base64url");
    }
    if (readCookie(req, CSRF_COOKIE) !== session.csrfToken) {
      res.cookie(CSRF_COOKIE, session.csrfToken, {
        httpOnly: false, // MUST be readable by JS so the client can echo it back
        sameSite: "lax",
        secure: isProd,
        path: "/",
      });
    }
  }
  next();
}

/** Reject state-changing requests whose header token doesn't match the session. */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  // Bearer-authenticated requests aren't subject to CSRF: the credential is not
  // ambient (the browser never attaches it automatically), and a cross-site page
  // can't set an Authorization header without a CORS preflight we don't grant.
  if (SAFE_METHODS.has(req.method) || hasBearer(req)) {
    next();
    return;
  }
  const sent = req.get(CSRF_HEADER);
  const expected = req.session?.csrfToken;
  if (sent && expected && timingSafeEqual(sent, expected)) {
    next();
    return;
  }
  res.status(403).json({ error: "invalid csrf token" });
}
