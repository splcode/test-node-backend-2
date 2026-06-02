import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

let db: Kysely<Database> | undefined;

/** Lazily create a single shared Kysely instance from DATABASE_URL. */
export function getDb(): Kysely<Database> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
    });
  }
  return db;
}
