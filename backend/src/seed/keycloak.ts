/**
 * Seeds a demo realm into the local Phase Two Keycloak (docker-compose service
 * `keycloak`). Idempotent — safe to re-run; it creates-or-updates rather than
 * failing on existing objects.
 *
 * What it builds in realm `app`:
 *   - client scope `organizations` — Phase Two "Organization Role" mapper, so
 *     tokens carry an `organizations` claim: { "<orgId>": { name, roles: [...] } }
 *   - client scope `api` — Audience mapper stamping `aud: app-api`, so the
 *     resource-server (jose) audience check has something to verify
 *   - client `web-bff` — confidential, auth-code + PKCE, the browser BFF
 *   - client `api-m2m` — confidential, service account, for client-credentials
 *   - client `dev-tools` — public, auth-code + PKCE (+ direct grant), for hand-
 *     testing tokens from Postman / Insomnia / curl (no secret)
 *   - realm role `app-admin` — the only realm role; being authenticated already
 *     means you're a user. It rides for free in the standard `realm_access.roles`
 *     (Keycloak's default `roles` scope), no custom mapper. Both `demo` and the
 *     api-m2m service account hold it, so their tokens carry a realm role.
 *   - each org has roles `admin` and `manager` (plain members need no role)
 *   - user `demo` / `demo`: realm `app-admin`, and a different org role in each:
 *     acme → admin, globex → manager
 *
 * Run:  npm run seed:keycloak -w backend   (Keycloak must be up first)
 */

const BASE = process.env.KC_BASE_URL ?? "http://localhost:8082";
const ADMIN_USER = process.env.KC_ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.KC_ADMIN_PASS ?? "admin";
const REALM = process.env.SEED_REALM ?? "app";
// For a hosted realm where you don't have the master admin: a confidential client
// in the target realm with realm-management roles (realm-admin). When these are
// set, the seeder authenticates via client-credentials instead of admin-cli.
const ADMIN_CLIENT_ID = process.env.KC_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.KC_ADMIN_CLIENT_SECRET;

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
// Vite dev server origin. In dev the browser stays on :5173 (Vite proxies /api
// and /auth to Express), so the OIDC redirect lands here too — register it as a
// valid callback/origin alongside the Express origin.
const DEV_WEB_URL = process.env.DEV_WEB_URL ?? "http://localhost:5173";
const WEB_CLIENT_ID = "web-bff";
const WEB_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "dev-secret-change-me";
const M2M_CLIENT_ID = "api-m2m";
const M2M_CLIENT_SECRET = process.env.M2M_CLIENT_SECRET ?? "dev-m2m-secret";
const API_AUDIENCE = process.env.OIDC_AUDIENCE ?? "app-api";
// Public client for hand-testing the auth-code flow from Postman / Insomnia / curl.
const TOOLS_CLIENT_ID = "dev-tools";

const DEMO_USER = "demo";
const DEMO_PASS = "demo";
const DEMO_EMAIL = "demo@example.com";

// Each org carries the same two elevated roles: `admin` and `manager`. Plain
// membership needs no role — a member is implicitly a user. The demo user is
// admin of one org and manager of the other.
const ORG_ROLES = ["admin", "manager"] as const;
const DEMO_ORG_ROLE: Record<string, (typeof ORG_ROLES)[number]> = {
  acme: "admin",
  globex: "manager",
};

let TOKEN = "";

function log(msg: string): void {
  console.log(msg);
}

async function getAdminToken(): Promise<string> {
  // Hosted realm: client-credentials on a realm-management client in the target
  // realm. Local dev: password grant on the master realm's admin-cli.
  const useClient = Boolean(ADMIN_CLIENT_ID && ADMIN_CLIENT_SECRET);
  const tokenUrl = useClient
    ? `${BASE}/realms/${REALM}/protocol/openid-connect/token`
    : `${BASE}/realms/master/protocol/openid-connect/token`;
  const body: Record<string, string> = useClient
    ? { grant_type: "client_credentials", client_id: ADMIN_CLIENT_ID!, client_secret: ADMIN_CLIENT_SECRET! }
    : { grant_type: "password", client_id: "admin-cli", username: ADMIN_USER, password: ADMIN_PASS };
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`admin login failed: ${res.status} ${await res.text()}\n` +
      `Is Keycloak reachable at ${BASE}?`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/** Bearer-authenticated request against the Keycloak server. */
async function req(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Returns the response if ok (or status is tolerated), else throws with the body. */
async function ok(res: Response, tolerate: number[] = []): Promise<Response> {
  if (res.ok || tolerate.includes(res.status)) return res;
  throw new Error(`${res.status} ${res.statusText} on ${res.url}\n${await res.text()}`);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Pull the new resource id out of a 201 Location header. */
function idFromLocation(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? loc.substring(loc.lastIndexOf("/") + 1) : null;
}

// --- Realm -----------------------------------------------------------------

async function ensureRealm(): Promise<void> {
  if ((await req("GET", `/admin/realms/${REALM}`)).ok) {
    log(`realm ${REALM}: exists`);
    return;
  }
  await ok(await req("POST", `/admin/realms`, {
    realm: REALM,
    enabled: true,
    loginWithEmailAllowed: true,
    registrationAllowed: false,
  }));
  log(`realm ${REALM}: created`);
}

// --- Client scopes + mappers ------------------------------------------------

interface Mapper {
  name: string;
  protocol: string;
  protocolMapper: string;
  config: Record<string, string>;
}

async function ensureClientScope(name: string, mappers: Mapper[]): Promise<string> {
  let scopes = await json<Array<{ id: string; name: string }>>(
    await req("GET", `/admin/realms/${REALM}/client-scopes`),
  );
  let scope = scopes.find((s) => s.name === name);
  if (!scope) {
    await ok(await req("POST", `/admin/realms/${REALM}/client-scopes`, {
      name,
      protocol: "openid-connect",
      attributes: { "include.in.token.scope": "true", "display.on.consent.screen": "false" },
    }), [409]);
    scopes = await json(await req("GET", `/admin/realms/${REALM}/client-scopes`));
    scope = scopes.find((s) => s.name === name);
    log(`client-scope ${name}: created`);
  } else {
    log(`client-scope ${name}: exists`);
  }
  const scopeId = scope!.id;

  const existing = await json<Array<{ name: string }>>(
    await req("GET", `/admin/realms/${REALM}/client-scopes/${scopeId}/protocol-mappers/models`),
  );
  for (const m of mappers) {
    if (existing.some((e) => e.name === m.name)) continue;
    await ok(await req(
      "POST",
      `/admin/realms/${REALM}/client-scopes/${scopeId}/protocol-mappers/models`,
      m,
    ), [409]);
    log(`  mapper ${m.name}: added`);
  }
  return scopeId;
}

const orgRoleMapper: Mapper = {
  name: "organizations",
  protocol: "openid-connect",
  protocolMapper: "oidc-organization-role-mapper",
  config: {
    "claim.name": "organizations",
    "access.token.claim": "true",
    "id.token.claim": "true",
    "userinfo.token.claim": "true",
  },
};

const audienceMapper: Mapper = {
  name: "api-audience",
  protocol: "openid-connect",
  protocolMapper: "oidc-audience-mapper",
  config: {
    "included.custom.audience": API_AUDIENCE,
    "access.token.claim": "true",
    "id.token.claim": "false",
    "introspection.token.claim": "true",
  },
};

// Note: realm roles need no mapper here — Keycloak's default `roles` scope already
// puts them in every access token under the standard `realm_access.roles`. The BFF
// reads them from the access token (see auth/oidc.ts). The ID token deliberately 
// does NOT carry them.

// --- Clients ----------------------------------------------------------------

async function ensureClient(rep: Record<string, unknown>): Promise<string> {
  const clientId = rep.clientId as string;
  const found = await json<Array<Record<string, unknown> & { id: string }>>(
    await req("GET", `/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(clientId)}`),
  );
  if (found.length > 0) {
    const id = found[0].id;
    await ok(await req("PUT", `/admin/realms/${REALM}/clients/${id}`, { ...found[0], ...rep }));
    log(`client ${clientId}: updated`);
    return id;
  }
  const res = await ok(await req("POST", `/admin/realms/${REALM}/clients`, rep));
  log(`client ${clientId}: created`);
  return idFromLocation(res)!;
}

async function assignDefaultScope(clientInternalId: string, scopeId: string): Promise<void> {
  await ok(
    await req("PUT", `/admin/realms/${REALM}/clients/${clientInternalId}/default-client-scopes/${scopeId}`),
    [409],
  );
}

async function getClientSecret(clientInternalId: string): Promise<string> {
  const res = await json<{ value: string }>(
    await req("GET", `/admin/realms/${REALM}/clients/${clientInternalId}/client-secret`),
  );
  return res.value;
}

// --- Realm roles + user -----------------------------------------------------

async function ensureRealmRole(name: string): Promise<void> {
  if ((await req("GET", `/admin/realms/${REALM}/roles/${name}`)).ok) return;
  await ok(await req("POST", `/admin/realms/${REALM}/roles`, { name }), [409]);
  log(`realm-role ${name}: created`);
}

async function ensureUser(): Promise<string> {
  const found = await json<Array<{ id: string }>>(
    await req("GET", `/admin/realms/${REALM}/users?username=${DEMO_USER}&exact=true`),
  );
  let id: string;
  if (found.length > 0) {
    id = found[0].id;
    log(`user ${DEMO_USER}: exists`);
  } else {
    const res = await ok(await req("POST", `/admin/realms/${REALM}/users`, {
      username: DEMO_USER,
      enabled: true,
      emailVerified: true,
      email: DEMO_EMAIL,
      firstName: "Demo",
      lastName: "User",
    }));
    id = idFromLocation(res)!;
    log(`user ${DEMO_USER}: created`);
  }
  await ok(await req("PUT", `/admin/realms/${REALM}/users/${id}/reset-password`, {
    type: "password",
    value: DEMO_PASS,
    temporary: false,
  }));
  return id;
}

async function assignRealmRole(userId: string, roleName: string): Promise<void> {
  const role = await json<{ id: string; name: string }>(
    await req("GET", `/admin/realms/${REALM}/roles/${roleName}`),
  );
  await ok(
    await req("POST", `/admin/realms/${REALM}/users/${userId}/role-mappings/realm`, [
      { id: role.id, name: role.name },
    ]),
    [409],
  );
}

/** The user id of a service-account client, so we can grant it realm roles. */
async function serviceAccountUserId(clientInternalId: string): Promise<string> {
  const user = await json<{ id: string }>(
    await req("GET", `/admin/realms/${REALM}/clients/${clientInternalId}/service-account-user`),
  );
  return user.id;
}

// --- Phase Two organizations ------------------------------------------------

async function ensureOrg(name: string, displayName: string, domains: string[]): Promise<string> {
  const list = await json<Array<{ id: string; name: string }>>(await req("GET", `/realms/${REALM}/orgs`));
  const existing = list.find((o) => o.name === name);
  if (existing) {
    log(`org ${name}: exists`);
    return existing.id;
  }
  const res = await ok(await req("POST", `/realms/${REALM}/orgs`, {
    name,
    displayName,
    domains,
    url: "",
    attributes: {},
  }));
  log(`org ${name}: created`);
  const id = idFromLocation(res);
  if (id) return id;
  // Fall back to a lookup if the server didn't send a Location header.
  const after = await json<Array<{ id: string; name: string }>>(await req("GET", `/realms/${REALM}/orgs`));
  return after.find((o) => o.name === name)!.id;
}

async function addOrgMember(orgId: string, userId: string): Promise<void> {
  await ok(await req("PUT", `/realms/${REALM}/orgs/${orgId}/members/${userId}`), [201, 204, 409]);
}

async function ensureOrgRole(orgId: string, name: string): Promise<void> {
  await ok(await req("POST", `/realms/${REALM}/orgs/${orgId}/roles`, { name }), [201, 409]);
}

async function grantOrgRole(orgId: string, roleName: string, userId: string): Promise<void> {
  await ensureOrgRole(orgId, roleName);
  await ok(
    await req("PUT", `/realms/${REALM}/orgs/${orgId}/roles/${encodeURIComponent(roleName)}/users/${userId}`),
    [201, 204, 409],
  );
}

// --- Verification: prove the API (client-credentials) leg end-to-end ---------

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function verifyClientCredentials(): Promise<void> {
  const res = await fetch(`${BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    log(`  (verify skipped: client_credentials failed ${res.status})`);
    return;
  }
  const tok = (await res.json()) as { access_token: string };
  const payload = decodeJwtPayload(tok.access_token);
  log(`  client_credentials token aud = ${JSON.stringify(payload.aud)}  (expected to include "${API_AUDIENCE}")`);
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Seeding ${BASE} realm "${REALM}"...\n`);
  TOKEN = await getAdminToken();

  await ensureRealm();

  const orgScopeId = await ensureClientScope("organizations", [orgRoleMapper]);
  const apiScopeId = await ensureClientScope("api", [audienceMapper]);

  const webId = await ensureClient({
    clientId: WEB_CLIENT_ID,
    name: "Web BFF",
    protocol: "openid-connect",
    publicClient: false,
    secret: WEB_CLIENT_SECRET,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${APP_URL}/auth/callback`, `${DEV_WEB_URL}/auth/callback`],
    webOrigins: [APP_URL, DEV_WEB_URL],
    attributes: {
      "pkce.code.challenge.method": "S256",
      // Keycloak separates multiple post-logout URIs with `##`.
      "post.logout.redirect.uris": `${APP_URL}/*##${DEV_WEB_URL}/*`,
    },
  });
  await assignDefaultScope(webId, orgScopeId);
  await assignDefaultScope(webId, apiScopeId);

  const m2mId = await ensureClient({
    clientId: M2M_CLIENT_ID,
    name: "API M2M client",
    protocol: "openid-connect",
    publicClient: false,
    secret: M2M_CLIENT_SECRET,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    redirectUris: [],
    webOrigins: [],
  });
  await assignDefaultScope(m2mId, apiScopeId);

  // Public client for API testing tools (Postman / Insomnia / curl). No secret —
  // authorization-code + PKCE. Direct (password) grant is also on for a quick
  // token without the browser hop. Redirect URIs cover the tools' callbacks.
  const toolsId = await ensureClient({
    clientId: TOOLS_CLIENT_ID,
    name: "Dev tools (Postman/Insomnia, auth-code + PKCE)",
    protocol: "openid-connect",
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    redirectUris: [
      "https://oauth.pstmn.io/v1/callback", 
      "http://localhost:8080/callback", 
      "http://localhost:3000/callback",
    ],
    webOrigins: ["+"],
    attributes: { "pkce.code.challenge.method": "S256" },
  });
  await assignDefaultScope(toolsId, orgScopeId);
  await assignDefaultScope(toolsId, apiScopeId);

  // Only one realm role: `app-admin`. Both the demo user and the m2m service
  // account hold it, so each token carries realm_access.roles.
  await ensureRealmRole("app-admin");
  await assignRealmRole(await serviceAccountUserId(m2mId), "app-admin");

  const userId = await ensureUser();
  await assignRealmRole(userId, "app-admin");

  const acme = await ensureOrg("acme", "Acme Inc", ["acme.example.com"]);
  const globex = await ensureOrg("globex", "Globex LLC", ["globex.example.com"]);

  await addOrgMember(acme, userId);
  await addOrgMember(globex, userId);

  // Define both roles on each org, then grant the demo user their one role per org.
  for (const [name, orgId] of [["acme", acme], ["globex", globex]] as const) {
    for (const role of ORG_ROLES) await ensureOrgRole(orgId, role);
    await grantOrgRole(orgId, DEMO_ORG_ROLE[name], userId);
  }
  log(`memberships: demo → acme [${DEMO_ORG_ROLE.acme}], globex [${DEMO_ORG_ROLE.globex}]`);

  const webSecret = await getClientSecret(webId);
  log(`\nVerifying API client-credentials leg:`);
  await verifyClientCredentials();

  log(`
─────────────────────────────────────────────────────────────
 Seed complete. Put these in your .env:

   OIDC_ISSUER=${BASE}/realms/${REALM}
   OIDC_CLIENT_ID=${WEB_CLIENT_ID}
   OIDC_CLIENT_SECRET=${webSecret}
   OIDC_REDIRECT_URI=${APP_URL}/auth/callback
   OIDC_AUDIENCE=${API_AUDIENCE}

 Browser login (web-bff, auth-code + PKCE):  user "${DEMO_USER}" / "${DEMO_PASS}"
 API client (client-credentials):            ${M2M_CLIENT_ID} / ${M2M_CLIENT_SECRET}
 Admin console:                              ${BASE}  (${ADMIN_USER}/${ADMIN_PASS})

 demo's ID token carries identity + the "organizations" claim:
   "organizations": {
     "<acme-id>":   { "name": "acme",   "roles": ["admin"] },
     "<globex-id>": { "name": "globex", "roles": ["manager"] }
   }
 demo's ACCESS token additionally carries realm roles (free, standard claim):
   "realm_access": { "roles": ["app-admin", ...] }
─────────────────────────────────────────────────────────────`);
}

main().catch((err: unknown) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
