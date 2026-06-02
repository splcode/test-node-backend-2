# express-vite-sample

A minimal TypeScript sample: an Express API and a Vite frontend served from a
single Node process, backed by Postgres.

- **Backend** — Node + Express + TypeScript. Serves the JSON API and the built
  frontend on one port.
- **Frontend** — vanilla TypeScript + Vite + [Pico.css](https://picocss.com/).
  Fetches `/api/v1/sample` and renders the list.
- **Database** — Postgres, queried with [Kysely](https://kysely.dev/). Plain-SQL
  migrations run automatically on startup.

## Layout

```
backend/src/
  server.ts          Express API + static file serving + migrate-on-boot
  db.ts              Kysely instance, schema types, migrations
  contracts.ts       API types shared with the frontend (type-only)
  migrations/        plain-SQL migrations
frontend/            Vite + vanilla TS + Pico
Dockerfile           multi-stage build -> slim runtime image
docker-compose.yml   local Postgres for development
```

## Local development

```bash
npm install
cp .env.example .env       # DATABASE_URL for the local Postgres
docker compose up -d       # start Postgres (host port 5433)
npm run dev:api            # Express on http://localhost:3000
npm run dev:web            # Vite on http://localhost:5173 (separate terminal)
```

Open http://localhost:5173 — Vite proxies `/api/*` to Express. The app creates
and seeds the `sample` table on first boot.

## Production build

```bash
docker build -t express-vite-sample .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db express-vite-sample
```

The image serves the API and static frontend on port 3000 and runs pending
migrations on startup.
