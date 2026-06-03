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
 *   - realm roles `app-admin`, `app-user`
 *   - user `demo` / `demo`, member of two orgs with different roles:
 *       acme   → manage-organization, manage-members, billing-admin (org admin)
 *       globex → view-organization, view-members                   (read-only)
 *
 * Run:  npm run seed:keycloak -w backend   (Keycloak must be up first)
 */

const BASE = process.env.KC_BASE_URL ?? "http://localhost:8082";
const ADMIN_USER = process.env.KC_ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.KC_ADMIN_PASS ?? "admin";
const REALM = process.env.SEED_REALM ?? "app";

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

const DEMO_USER = "demo";
const DEMO_PASS = "demo";
const DEMO_EMAIL = "demo@example.com";

// Phase Two creates a default set of org roles per org; we also add a custom one
// (billing-admin) to show custom roles. grantOrgRole() create-or-ignores first,
// so this works whether or not the default roles already exist.
const ACME_ROLES = ["manage-organization", "manage-members", "billing-admin"];
const GLOBEX_ROLES = ["view-organization", "view-members"];

let TOKEN = "";

function log(msg: string): void {
  console.log(msg);
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });
  if (!res.ok) {
    throw new Error(`admin login failed: ${res.status} ${await res.text()}\n` +
      `Is Keycloak up at ${BASE}? Try: docker compose up -d keycloak`);
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

  await ensureRealmRole("app-admin");
  await ensureRealmRole("app-user");

  const userId = await ensureUser();
  await assignRealmRole(userId, "app-user");

  const acme = await ensureOrg("acme", "Acme Inc", ["acme.example.com"]);
  const globex = await ensureOrg("globex", "Globex LLC", ["globex.example.com"]);

  await addOrgMember(acme, userId);
  await addOrgMember(globex, userId);
  for (const role of ACME_ROLES) await grantOrgRole(acme, role, userId);
  for (const role of GLOBEX_ROLES) await grantOrgRole(globex, role, userId);
  log(`memberships: demo → acme [${ACME_ROLES.join(", ")}], globex [${GLOBEX_ROLES.join(", ")}]`);

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

 On login, demo's ID/access token will carry:
   "organizations": {
     "<acme-id>":   { "name": "acme",   "roles": ["manage-organization","manage-members","billing-admin"] },
     "<globex-id>": { "name": "globex", "roles": ["view-organization","view-members"] }
   }
─────────────────────────────────────────────────────────────`);
}

main().catch((err: unknown) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
