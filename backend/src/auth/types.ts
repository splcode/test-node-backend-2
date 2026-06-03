// Augments express-session's SessionData with our app-specific fields. This file
// has no runtime output; the `declare module` block makes `req.session.user` /
// `req.session.oidc` typed everywhere across the codebase. The user/org shapes
// live in contracts.ts so the frontend shares one definition.
//
// We keep the full org-membership map (rather than pinning one active org) so
// per-request authorization can resolve against any org; an `activeOrgId` +
// switch endpoint can be layered on later if needed.
import type { SessionUser } from "../contracts.js";

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    /**
     * OIDC login transaction state held between /auth/login and /auth/callback.
     * Cleared once the authorization code is exchanged. state/nonce/codeVerifier
     * are standard OIDC; returnTo is where to send the browser post-login.
     */
    oidc?: { state: string; nonce: string; codeVerifier: string; returnTo?: string };
    /**
     * ID token kept solely as the `id_token_hint` for RP-initiated logout. We do
     * not yet persist the access/refresh tokens — the BFF doesn't call resource
     * servers on the user's behalf yet; add them here when it needs to.
     */
    idToken?: string;
    /** Double-submit CSRF token; mirrored to the readable XSRF-TOKEN cookie. */
    csrfToken?: string;
  }
}
