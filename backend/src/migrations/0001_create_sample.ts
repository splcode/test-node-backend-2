import { Kysely, sql } from "kysely";

// Migrations run against an untyped Kysely instance.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("sample")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db
    .insertInto("sample")
    .values([
      { name: "Alpha", description: "The first sample item." },
      { name: "Bravo", description: "The second sample item." },
      { name: "Charlie", description: "The third sample item." },
      { name: "Delta", description: "The fourth sample item." },
      { name: "Echo", description: "The fifth sample item." },
    ])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("sample").execute();
}
