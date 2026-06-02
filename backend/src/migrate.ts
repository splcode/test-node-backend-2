import { getDb } from "./db";
import { createMigrator, logMigrations } from "./db/migrator";

/**
 * Manual migration CLI (the app also auto-migrates on startup).
 *   npm run migrate        -> migrate to latest
 *   npm run migrate:down   -> roll back the last migration
 */
async function main(): Promise<void> {
  const direction = process.argv[2] ?? "latest";
  const migrator = createMigrator();

  const { error, results } =
    direction === "down"
      ? await migrator.migrateDown()
      : await migrator.migrateToLatest();

  logMigrations(results);
  await getDb().destroy();

  if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
