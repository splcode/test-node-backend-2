# express-vite-sample

A minimal TypeScript sample with mark pizzaz: an Express API and a Vite frontend 
served from a single Node process, backed by Postgres.

This can be the future basis of the next project future Mark writes - right?

- **Backend** — Node + Express + TypeScript. Serves the JSON API and the built
  frontend on one port.
- **Frontend** — vanilla TypeScript + Vite + [Pico.css](https://picocss.com/).
  Fetches `/api/v1/sample` and renders the list. Pico just for a pretty demo.
- **Database** — Postgres, queried with [Kysely](https://kysely.dev/). Plain-SQL
  migrations run automatically on startup.

Dependencies are chosen deliberately to be those with low dependencies themselves.

## Layout

```
backend/src/
  server.ts          Express API + static file serving + migrate-on-boot
  db.ts              Kysely instance, schema types, migrations
  contracts.ts       API types shared with the frontend (type-only)
  auth/session.ts    express-session, Postgres-backed (connect-pg-simple)
  auth/types.ts      session shape augmentation (req.session.user)
  migrations/        plain-SQL migrations (incl. the session table)
  seed/keycloak.ts   idempotent seeder for the dev Keycloak realm
frontend/            Vite + vanilla TS + Pico
Dockerfile           multi-stage build -> slim runtime image
docker-compose.yml   local Postgres + Phase Two Keycloak for development
```

## Local development

```bash
npm install
cp .env.example .env       # DATABASE_URL for the local Postgres
docker compose up -d       # start Postgres (host port 5433)
npm run dev:api            # Express on http://localhost:3000
npm run dev:web            # Vite on http://localhost:5173 (separate terminal)
```

Open http://localhost:5173 — Vite proxies `/api/*` and `/auth/*` to Express. The
app creates and seeds the `sample` table on first boot. The samples are behind
auth now, so click **Log in** and sign in as `demo` / `demo` (see below).

## Authentication (dev)

Auth is OpenID Connect against a [Phase Two](https://phasetwo.io/) Keycloak
(organizations support). The model is a **Backend-for-Frontend**: the browser
gets an httpOnly session cookie, Express holds the tokens and talks to Keycloak
as a confidential client; machine clients call the API with bearer JWTs
validated by [`jose`](https://github.com/panva/jose).

```bash
docker compose up -d keycloak      # Keycloak on http://localhost:8082 (admin/admin)
npm run seed:keycloak -w backend   # create the `app` realm, clients, demo data
```

The seeder ([`backend/src/seed/keycloak.ts`](backend/src/seed/keycloak.ts)) is
idempotent and prints the exact `.env` values to use. It provisions:

- `web-bff` — confidential client, authorization-code + PKCE (browser login)
- `api-m2m` — confidential client, client-credentials (machine API clients);
  its service account holds the `app-admin` realm role
- `dev-tools` — **public** client (no secret), authorization-code + PKCE
- client scopes that add an `organizations` claim (per-org roles) and stamp the
  API `aud` onto access tokens
- realm role `app-admin` (the only one — being authenticated already means
  you're a user), and `admin` / `manager` roles in each org
- user **`demo` / `demo`**: realm `app-admin`, **acme** → `admin`,
  **globex** → `manager`

Two role dimensions flow into the app, each from its native place in the token:
**org roles** ride the `organizations` claim (ID + access token), and
**realm roles** ride the standard `realm_access.roles` (access token only —
Keycloak's default `roles` scope, no custom mapper). The BFF reads realm roles
off the access token it holds; a bearer client gets them straight from its
verified token.

Once seeded, the server exposes the browser login flow:

- `GET /auth/login` → redirects to Keycloak (authorization-code + PKCE)
- `GET /auth/callback` → exchanges the code, maps the `organizations` claim into
  the session, redirects home
- `POST /auth/logout` → destroys the session and returns the Keycloak
  end-session URL for the SPA to navigate to (POST-only, so no cross-site GET)
- `GET /api/v1/me` → the current session user; everything under `/api/v1` now
  requires a session

The same `/api/v1` routes accept **either** a browser session **or** a bearer
token — validated with [`jose`](https://github.com/panva/jose) against the
issuer's JWKS (signature + issuer + `app-api` audience). Bearer requests carry
their own credential, so they're exempt from the CSRF check. See
[Getting in](#getting-in-a-token-postman--insomnia--curl-or-the-browser-session)
for how to obtain a token or use the session.

The frontend drives the browser side: it calls `/api/v1/me`, shows a **Log in**
button when logged out and the user + their org roles + a **Log out** button when
signed in.

In dev the browser stays on the Vite origin (`:5173`) the whole time — Vite
proxies `/auth/*` to Express and the seeded `web-bff` client allows the `:5173`
callback, so the cookie-based flow works with HMR. (`OIDC_REDIRECT_URI` selects
the origin; switch it to `:3000` to run the built SPA from Express single-origin.)

CSRF: a double-submit token. The server hands the browser a readable `XSRF-TOKEN` 
cookie; the `ApiClient` echoes it back in an `X-XSRF-TOKEN` header on every 
mutation, and the server verifies it against the token stored in the **session** 
(not just the cookie) - so it holds even if an attacker can overwrite the cookie
from a sibling subdomain. `SameSite=Lax` is the first line of defense; this is
the second.

Browsers reach Keycloak over plain `http` in dev, which openid-client normally
forbids; the http-only relaxation is applied **only** when `OIDC_ISSUER` is
`http:` (prod issuers are `https` and stay strict).

The dev Keycloak uses an embedded H2 database persisted in the `kcdata` volume;
production points at a hosted Phase Two via `KEYCLOAK_VERSION` / `OIDC_*` env.

## Getting in: a token (Postman / Insomnia / curl) or the browser session

Everything under `/api/v1/*` accepts **either** a browser session **or** a bearer
token. Three ways to get there. The endpoints differ only by realm - use the row
that matches where you're testing:

|          | Local (`app` realm)                | Hosted / prod (`spl-testing-1`)                  |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Issuer   | `http://localhost:8082/realms/app` | `https://usw2.auth.ac/auth/realms/spl-testing-1` |
| API base | `http://localhost:3000`            | `https://node-test-2.splsetup.com`               |

(`<issuer>/protocol/openid-connect/auth` and `…/token` are the OAuth endpoints;
the seeded clients — `dev-tools`, `api-m2m`, `web-bff` — exist on both realms.)

### Public client `dev-tools` — a user token, no secret

`dev-tools` is a **public** client: authorization-code + PKCE, **no client
secret**. This is the simplest way to mint a real user token for API testing.
Tools that drive the flow for you: [Postman](https://www.postman.com/) and
[Insomnia](https://insomnia.rest/).

In the tool's OAuth 2.0 settings pick **Authorization Code (With PKCE)** and fill
in (local realm shown — swap the issuer host for a hosted realm):

| Field | Value |
| ---------------------- | ---------------------------------------------------------------------- |
| Auth URL               | `http://localhost:8082/realms/app/protocol/openid-connect/auth`        |
| Access Token URL       | `http://localhost:8082/realms/app/protocol/openid-connect/token`       |
| Client ID              | `dev-tools`                                                            |
| Client Secret          | *(leave blank — public client)*                                        |
| Code Challenge Method  | SHA-256 (PKCE)                                                         |
| Scope                  | `openid profile email`                                                 |
| Redirect URL           | `https://oauth.pstmn.io/v1/callback` `http://localhost:8080/callback` or `http://localhost:3000/callback` |

Run it, sign in as `demo` / `demo`, and the tool captures the **access token**.

Send it as a bearer:

```http
GET http://localhost:3000/api/v1/sample
Authorization: Bearer <access_token>
```

No browser? `dev-tools` also allows the direct (password) grant for a one-liner but
this would not likely be allowed in prod due to 2FA requirements and such:

```bash
# local
TOKEN=$(curl -s -X POST http://localhost:8082/realms/app/protocol/openid-connect/token \
  -d grant_type=password -d client_id=dev-tools \
  -d username=demo -d password=demo -d scope=openid | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/sample

# hosted / prod — same public client, no secret, just the other realm's URLs
TOKEN=$(curl -s -X POST https://usw2.auth.ac/auth/realms/spl-testing-1/protocol/openid-connect/token \
  -d grant_type=password -d client_id=dev-tools \
  -d username=demo -d password=demo -d scope=openid | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" https://node-test-2.splsetup.com/api/v1/sample
```

Tip: hit `/api/v1/me` with the token and you'll see who it resolved to —
including `"via":"bearer"` and the `client` it was issued to.

### Confidential client — when the caller can keep a secret

A **confidential** client needs both a **client ID *and* secret** — you must have
the secret to use it. Use one for server-side callers or the client-credentials
machine grant. The seeded `api-m2m` does client-credentials:

```bash
# local — api-m2m with the dev secret (the committed default)
TOKEN=$(curl -s -X POST http://localhost:8082/realms/app/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=api-m2m -d client_secret=dev-m2m-secret \
  | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/sample

# hosted / prod — your prod machine client; keep its secret out of the repo
# (it lives in Coolify / .env.production):
M2M_SECRET=…   # the node-test-2-m2m secret
TOKEN=$(curl -s -X POST https://usw2.auth.ac/auth/realms/spl-testing-1/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=node-test-2-m2m -d client_secret="$M2M_SECRET" \
  | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" https://node-test-2.splsetup.com/api/v1/sample
```

Either way, `/api/v1/me` resolves the **service-account user** for a
client-credentials token (`"name":"service-account-…"`, its realm roles, no orgs).

You can also run **authorization code** against a confidential client in
Postman/Insomnia — same setup as `dev-tools` above, but select the confidential
client and paste its **secret** (and register the tool's redirect URI on it).
`web-bff` and the prod client are confidential, but they're the app's own BFF
clients.

### Browser — the session cookie

Or just open the app — [http://localhost:5173](http://localhost:5173) in dev (or
your deployed URL) — and click **Log in** (`demo` / `demo`). Express runs the
code exchange server-side and sets an **httpOnly session cookie**; the SPA calls
`/api/v1/*` and the cookie rides along automatically. You never handle a token in
the browser — that's the BFF model.

## Production build

```bash
docker build -t express-vite-sample .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db express-vite-sample
```

The image serves the API and static frontend on port 3000 and runs pending
migrations on startup.
