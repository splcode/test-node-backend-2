import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import type { ColumnType, Generated } from "kysely";
import { Pool } from "pg";
import Postgrator from "postgrator";

// Hand-written schema; keep in sync with the SQL migrations by hand
export interface Database {
  sample: {
    id: Generated<number>;
    name: string;
    description: string;
    bunny_count: number | null;
    created_at: ColumnType<Date, string | undefined, never>;
  };
}

// Exported so the session store (connect-pg-simple) shares this one pool rather
// than opening a second set of connections to the same database.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function migrateToLatest(): Promise<void> {
  const postgrator = new Postgrator({
    driver: "pg",
    migrationPattern: path.join(import.meta.dirname, "migrations", "*"),
    execQuery: (query) => pool.query(query),
  });
  const applied = await postgrator.migrate();
  for (const m of applied) {
    console.log(`migration ${m.version} ${m.action} ${m.name}`);
  }
}
