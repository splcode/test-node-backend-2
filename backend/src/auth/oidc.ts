import * as client from "openid-client";
import type { SessionUser, OrgMemberships } from "../contracts.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

const issuer = requireEnv("OIDC_ISSUER");
const clientId = requireEnv("OIDC_CLIENT_ID");
const clientSecret = requireEnv("OIDC_CLIENT_SECRET");
const redirectUri = requireEnv("OIDC_REDIRECT_URI");

export const REDIRECT_URI = redirectUri;
// Origin of this app, used as the post-logout redirect target. Trailing slash so
// it matches Keycloak's seeded `post.logout.redirect.uris` pattern (`<origin>/*`).
export const APP_BASE_URL = new URL(redirectUri).origin;

// `organizations` and `api` are *default* client scopes on web-bff, so Keycloak
// adds them automatically — we only need to request the identity scopes here.
// (organizations -> the per-org roles claim; api -> the app-api audience.)
export const SCOPE = "openid profile email";

// openid-client v6 refuses non-HTTPS endpoints. Our dev Keycloak is plain http
// on localhost, so opt that one case in; production issuers are https and stay
// strict. The `execute` hook also disables HTTPS-only on the returned config, so
// the later token / end-session calls work over http too.
const allowInsecure = new URL(issuer).protocol === "http:";

// Discovery is a one-time async round-trip; cache the promise so concurrent
// requests at startup share a single discovery rather than racing several.
let configPromise: Promise<client.Configuration> | undefined;
export function getOidcConfig(): Promise<client.Configuration> {
  // Default client authentication is client_secret_post using this secret, which
  // is exactly what Keycloak's "client-secret" authenticator accepts.
  configPromise ??= client.discovery(
    new URL(issuer),
    clientId,
    clientSecret,
    undefined,
    allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  return configPromise;
}

/** Shape of Keycloak's `organizations` token claim (per-org name + roles). */
interface OrgClaim {
  [orgId: string]: { name?: string; roles?: string[] };
}

// Keycloak ships these realm roles to everyone; drop them so `realmRoles` shows
// only our app's roles. `default-roles-<realm>` is the per-realm composite role.
const BUILTIN_REALM_ROLES = new Set(["offline_access", "uma_authorization"]);
function isAppRealmRole(role: string): boolean {
  return !BUILTIN_REALM_ROLES.has(role) && !role.startsWith("default-roles-");
}

/**
 * Pull realm roles out of the standard `realm_access.roles` claim (filtered to
 * our app's roles). This lives in the ACCESS token, not the ID token — same place
 * a Keycloak-aware Spring resource server reads them. Shared by the session and
 * bearer paths so both surface realm roles identically.
 */
export function extractRealmRoles(claims: Record<string, unknown>): string[] {
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles) ? realmAccess.roles : [];
  return roles.filter((r): r is string => typeof r === "string").filter(isAppRealmRole);
}

/**
 * Map the token claims into the principal we persist in the session. Identity and
 * the `organizations` claim come from the verified ID token; realm roles come from
 * the access token's `realm_access.roles` (the ID token doesn't carry them).
 * Defensive about claim shapes — a malformed entry degrades to empty rather than
 * throwing inside the callback.
 */
export function mapClaimsToUser(
  idClaims: Record<string, unknown>,
  accessClaims: Record<string, unknown>,
): SessionUser {
  const orgs = (idClaims.organizations ?? {}) as OrgClaim;
  const organizations: OrgMemberships = {};
  for (const [orgId, value] of Object.entries(orgs)) {
    organizations[orgId] = {
      name: typeof value?.name === "string" ? value.name : orgId,
      roles: Array.isArray(value?.roles) ? value.roles.filter((r): r is string => typeof r === "string") : [],
    };
  }
  const name =
    typeof idClaims.name === "string"
      ? idClaims.name
      : typeof idClaims.preferred_username === "string"
        ? idClaims.preferred_username
        : undefined;
  return {
    sub: String(idClaims.sub),
    email: typeof idClaims.email === "string" ? idClaims.email : undefined,
    name,
    realmRoles: extractRealmRoles(accessClaims),
    organizations,
  };
}

/**
 * Only allow same-site, path-relative post-login redirects. Rejects absolute
 * URLs and protocol-relative `//host` to close off open-redirect abuse.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}
