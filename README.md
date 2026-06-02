# coolify-hello

Express + Vite hello-world, built as a **single container** and deployed on **Coolify**.

- **Backend:** Node (LTS) + Express + TypeScript. Serves the JSON API **and** the
  built frontend from one process on one port.
- **Frontend:** vanilla TypeScript + Vite + [Pico.css](https://picocss.com/).
  Fetches `/api/v1/sample` and renders the list.
- **Database:** [Kysely](https://kysely.dev/) + Postgres. The app reads samples
  from the database and **auto-migrates on startup** (Flyway-style), so a fresh
  database is created and seeded the first time the app boots.

## Layout

```
backend/        Express API + static serving + Kysely
  src/
    server.ts          API, static files, caching headers, SPA fallback, /api/health,
                       and the auto-migrate-on-boot step
    contracts.ts       PURE API types — the frontend import type's these
    samples.ts         listSamples() — the Kysely query behind /api/v1/sample
    db/
      index.ts         Kysely instance (pg pool from DATABASE_URL)
      types.ts         hand-written Database interface
      migrator.ts      shared migrator + migrateToLatest()
    migrations/        Kysely migrations (0001_create_sample.ts)
    migrate.ts         manual migration CLI (the app also auto-migrates on boot)
frontend/       Vite + vanilla TS + Pico
Dockerfile      multi-stage build -> slim runtime (used by Coolify)
docker-compose.yml   LOCAL-ONLY Postgres for development
```

## Local development

A Postgres database is required (`DATABASE_URL`). The app migrates itself on
startup, so there is no separate migrate step for normal dev.

```bash
npm install
cp .env.example .env   # sets DATABASE_URL to the local docker-compose Postgres
npm run db:up          # start local Postgres (host port 5433)
npm run dev            # Vite (http://localhost:5173) + Express (http://localhost:3000)
```

Open http://localhost:5173 — Vite proxies `/api/*` to Express, so there is no CORS.
On first boot the app creates and seeds the `sample` table automatically.

When the schema changes: add a migration in `backend/src/migrations/`, hand-update
`backend/src/db/types.ts` to match, and restart (or run `npm run db:migrate`).
`npm run db:migrate:down` rolls back the last migration. (Add `kysely-codegen`
later to generate `db/types.ts` from the live DB automatically.)

## Production build (what Coolify runs)

```bash
docker build -t coolify-hello .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db coolify-hello
```

The image serves the API and the static frontend on port 3000 and runs pending
migrations on startup.

### Caching behavior

- `index.html` is served with `Cache-Control: no-cache` (always revalidated), so a
  new deploy is picked up immediately.
- Vite-hashed assets under `/assets/*` get `Cache-Control: public, max-age=31536000, immutable`.

## Coolify settings

1. **New Resource → Application → your Git repo.**
2. **Build Pack:** `Dockerfile`.
3. **Port:** `3000`.
4. **Health check path:** `/api/health`.
5. **Database:** add a Postgres resource; copy its connection string.
6. **Environment variable:** `DATABASE_URL=<the Coolify Postgres connection string>`.

No pre-deploy command is needed — migrations run automatically when the app starts.
The server binds `0.0.0.0`, so the Coolify proxy can reach it.
