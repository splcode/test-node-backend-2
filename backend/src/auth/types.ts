// Augments express-session's SessionData with our app-specific fields. This file
// has no runtime output beyond the interfaces; the `declare module` block makes
// `req.session.user` / `req.session.oidc` typed everywhere across the codebase.

/** Per-org roles keyed by Keycloak organization id — mirrors the `organizations` token claim. */
export interface OrgMemberships {
  [orgId: string]: { name: string; roles: string[] };
}

/** The authenticated principal persisted in the session after OIDC login (step 2 fills this). */
export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  /**
   * All org memberships carried from the token. We keep the full map (rather than
   * pinning one active org) so per-request authorization can resolve against any
   * org; an `activeOrgId` + switch endpoint can be layered on later if needed.
   */
  organizations: OrgMemberships;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    /**
     * OIDC login transaction state held between /auth/login and /auth/callback.
     * Cleared once the authorization code is exchanged. state/nonce/codeVerifier
     * are standard OIDC; returnTo is where to send the browser post-login.
     */
    oidc?: { state: string; nonce: string; codeVerifier: string; returnTo?: string };
  }
}
