import * as client from "openid-client";
import type { SessionUser, OrgMemberships } from "./types.js";

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

/**
 * Map verified ID-token claims into the principal we persist in the session.
 * Defensive about claim shapes — a malformed `organizations` entry degrades to
 * empty roles rather than throwing inside the callback.
 */
export function mapClaimsToUser(claims: Record<string, unknown>): SessionUser {
  const orgs = (claims.organizations ?? {}) as OrgClaim;
  const organizations: OrgMemberships = {};
  for (const [orgId, value] of Object.entries(orgs)) {
    organizations[orgId] = {
      name: typeof value?.name === "string" ? value.name : orgId,
      roles: Array.isArray(value?.roles) ? value.roles.filter((r): r is string => typeof r === "string") : [],
    };
  }
  const name =
    typeof claims.name === "string"
      ? claims.name
      : typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : undefined;
  return {
    sub: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : undefined,
    name,
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
