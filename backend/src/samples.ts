import type { Sample } from "./contracts";
import { getDb } from "./db";

/** The five sample items, read from Postgres. */
export async function listSamples(): Promise<Sample[]> {
  const rows = await getDb()
    .selectFrom("sample")
    .select(["id", "name", "description", "created_at"])
    .orderBy("id")
    .limit(5)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
  }));
}
