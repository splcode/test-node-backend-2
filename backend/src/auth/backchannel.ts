import * as jose from "jose";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { getJwks } from "./oidc.js";

// The logout token is signed by the same realm key as our other tokens and its
// `aud` is this client. Read both at load so a misconfigured env fails fast.
const issuer = process.env.OIDC_ISSUER;
const clientId = process.env.OIDC_CLIENT_ID;
if (!issuer) throw new Error("OIDC_ISSUER must be set.");
if (!clientId) throw new Error("OIDC_CLIENT_ID must be set.");

// The event a logout token must declare (OIDC Back-Channel Logout §2.4).
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/** The session identifiers a validated logout token asks us to terminate. */
interface LogoutSubject {
  /** Keycloak SSO session id — targets exactly one browser session. */
  sid?: string;
  /** User id — targets every session the user holds (sid-less tokens). */
  sub?: string;
}

/**
 * Validate a Keycloak back-channel `logout_token` per the OIDC Back-Channel Logout
 * spec. jose checks the signature, issuer and audience; we then enforce the
 * logout-token-specific rules. Throws on any failure (the caller maps that to 400).
 */
export async function verifyLogoutToken(token: string): Promise<LogoutSubject> {
  const { payload } = await jose.jwtVerify(token, await getJwks(), {
    issuer,
    audience: clientId,
  });

  // Must declare the backchannel-logout event (§2.4 #3).
  const events = payload.events;
  if (
    typeof events !== "object" ||
    events === null ||
    !(BACKCHANNEL_LOGOUT_EVENT in (events as Record<string, unknown>))
  ) {
    throw new Error("logout token missing backchannel-logout event");
  }
  // A logout token MUST NOT carry a nonce (§2.4 #5) — its presence implies it was
  // minted as an ID token, not a logout token.
  if ("nonce" in payload) {
    throw new Error("logout token must not contain a nonce");
  }
  const sid = typeof payload.sid === "string" ? payload.sid : undefined;
  const sub = typeof payload.sub === "string" ? payload.sub : undefined;
  // At least one of sid/sub is required to know what to terminate (§2.4 #4).
  if (!sid && !sub) {
    throw new Error("logout token must contain sub or sid");
  }
  return { sid, sub };
}

/**
 * POST /auth/backchannel-logout — called server-to-server by Keycloak (not the
 * browser) when an SSO session ends elsewhere. Validates the logout token and
 * deletes the matching session row(s) from the express-session store, so the next
 * request on that cookie is unauthenticated.
 *
 * Mounted before the session + CSRF middleware (see server.ts): the request has
 * no session cookie and no XSRF token, so it must bypass both.
 */
export async function backchannelLogout(req: Request, res: Response): Promise<void> {
  // Spec: responses must not be cached.
  res.set("Cache-Control", "no-store");

  const token = (req.body as Record<string, unknown> | undefined)?.logout_token;
  if (typeof token !== "string") {
    res.status(400).json({ error: "missing logout_token" });
    return;
  }

  let subject: LogoutSubject;
  try {
    subject = await verifyLogoutToken(token);
  } catch {
    // Don't leak which validation failed.
    res.status(400).json({ error: "invalid logout_token" });
    return;
  }

  // Keycloak sends `sid` by default (backchannel.logout.session.required=true), so
  // we target that one session. A sid-less token (sub only) means "log the user out
  // everywhere" — match every session row carrying that user's sub. `->`/`->>`
  // operate on the `json` session column directly; no jsonb cast needed.
  if (subject.sid) {
    await pool.query(`DELETE FROM session WHERE sess ->> 'kcSid' = $1`, [subject.sid]);
  } else {
    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'sub' = $1`, [subject.sub]);
  }

  // Idempotent: a valid token always yields 200, even if no row matched (the
  // session may already be gone). Errors are reserved for malformed/invalid tokens.
  res.status(200).end();
}
