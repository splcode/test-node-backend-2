# coolify-hello

Express + Vite hello-world, built as a **single container** and deployed on **Coolify**.

- **Backend:** Node + Express + TypeScript. Serves the JSON API and the built
  frontend from one process on one port.
- **Frontend:** vanilla TypeScript + Vite + [Pico.css](https://picocss.com/).
  Fetches `/api/v1/sample` and renders the list.
- **Database:** Postgres. [Kysely](https://kysely.dev/) is the query builder for
  the API; plain-SQL migrations are run by [postgrator](https://github.com/rickbergfalk/postgrator)
  and **auto-applied on startup** (Flyway-style), so a fresh database is created
  and seeded the first time the app boots.

## Layout

```
backend/src/
  server.ts          Express API + static file serving + migrate-on-boot
  db.ts              Kysely instance, schema types, postgrator migrateToLatest()
  contracts.ts       API types shared with the frontend (type-only)
  migrations/        plain-SQL migrations (001.do.create-sample.sql)
frontend/            Vite + vanilla TS + Pico
Dockerfile           multi-stage build -> slim runtime (used by Coolify)
docker-compose.yml   LOCAL-ONLY Postgres for development
```

Migrations are versioned `NNN.do.<description>.sql` files, applied in order and
tracked in a `schemaversion` table. postgrator stores an md5 of each applied
migration and refuses to start if a migration is edited after it was applied
(forward-only — add a new migration to change the schema, don't edit old ones).

## Local development

```bash
npm install
cp .env.example .env   # sets DATABASE_URL to the local docker-compose Postgres
npm run db:up          # start local Postgres (host port 5433)
npm run dev            # Vite (http://localhost:5173) + Express (http://localhost:3000)
```

Open http://localhost:5173 — Vite proxies `/api/*` to Express, so there is no CORS.
On first boot the app creates and seeds the `sample` table automatically.

When the schema changes: add the next `NNN.do.<description>.sql` file in
`backend/src/migrations/`, update the `Database` interface in `backend/src/db.ts`
to match (it is hand-maintained — raw SQL does not generate TS types), and
restart. Wrap multi-statement migrations in `BEGIN; … COMMIT;` so they apply
atomically (postgrator does not wrap them for you).

## Production build (what Coolify runs)

```bash
docker build -t coolify-hello .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db coolify-hello
```

The image serves the API and the static frontend on port 3000 and runs pending
migrations on startup.

Vite-hashed assets under `/assets/*` are served `immutable` (cached forever);
`index.html` is served `no-cache` so a new deploy is picked up immediately.

## Coolify settings

1. **New Resource → Application → your Git repo.**
2. **Build Pack:** `Dockerfile`.
3. **Port:** `3000`.
4. **Health check path:** `/api/health`.
5. **Database:** add a Postgres resource; copy its connection string.
6. **Environment variable:** `DATABASE_URL=<the Coolify Postgres connection string>`.

Migrations run automatically when the app starts; no pre-deploy command is needed.
