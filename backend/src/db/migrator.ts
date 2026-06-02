import path from "node:path";
import { promises as fs } from "node:fs";
import { Migrator, FileMigrationProvider } from "kysely/migration";
import { getDb } from "./index";

type MigrationLogItem = {
  status: string;
  migrationName: string;
  direction: string;
};

/** Migrations live in src/migrations -> dist/migrations, one level up from db/. */
export function createMigrator(): Migrator {
  return new Migrator({
    db: getDb(),
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "..", "migrations"),
    }),
  });
}

export function logMigrations(
  results: readonly MigrationLogItem[] | undefined,
): void {
  for (const it of results ?? []) {
    if (it.status === "Success") {
      console.log(`✓ migration ${it.migrationName} (${it.direction})`);
    } else if (it.status === "Error") {
      console.error(`✗ migration ${it.migrationName} failed`);
    }
  }
}

/**
 * Apply all pending migrations. Idempotent and lock-guarded by Kysely, so it is
 * safe to call on every boot (Flyway-style) — even with multiple instances.
 */
export async function migrateToLatest(): Promise<void> {
  const { error, results } = await createMigrator().migrateToLatest();
  logMigrations(results);
  if (error) throw error;
}
