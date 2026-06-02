import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import type { ColumnType, Generated } from "kysely";
import { Pool } from "pg";

/** Hand-written schema — keep in sync with the SQL migrations by hand. */
export interface Database {
  sample: {
    id: Generated<number>;
    name: string;
    description: string;
    created_at: ColumnType<Date, string | undefined, never>;
  };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

/**
 * Apply pending SQL migrations on boot (Flyway-style) via postgrator.
 * Reads migrations/*.sql, tracks them in a `schemaversion` table, and
 * validates md5 checksums so an edited-after-apply migration is caught.
 */
export async function migrateToLatest(): Promise<void> {
  // postgrator 8 is ESM-only; dynamic import keeps this CommonJS module happy.
  const { default: Postgrator } = await import("postgrator");
  const postgrator = new Postgrator({
    driver: "pg",
    migrationPattern: path.join(__dirname, "migrations", "*"),
    execQuery: (query) => pool.query(query),
  });
  const applied = await postgrator.migrate();
  for (const m of applied) {
    console.log(`migration ${m.version} ${m.action} ${m.name}`);
  }
}
