import path from "node:path";
import { promises as fs } from "node:fs";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator, FileMigrationProvider } from "kysely/migration";
import type { ColumnType, Generated } from "kysely";
import { Pool } from "pg";

/** Hand-written schema — keep in sync with the migrations by hand. */
export interface Database {
  sample: {
    id: Generated<number>;
    name: string;
    description: string;
    created_at: ColumnType<Date, string | undefined, never>;
  };
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

/** Apply pending migrations. Safe to call on every boot. */
export async function migrateToLatest(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`migration ${r.migrationName}: ${r.status}`);
  }
  if (error) throw error;
}
