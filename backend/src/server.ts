import path from "node:path";
import express from "express";
import { db, migrateToLatest } from "./db";
import type { SampleListResponse } from "./contracts";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/v1/sample", async (_req, res) => {
  const rows = await db
    .selectFrom("sample")
    .select(["id", "name", "description", "bunny_count", "created_at"])
    .orderBy("id")
    .execute();
  const body: SampleListResponse = {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      bunnyCount: row.bunny_count,
      createdAt: row.created_at.toISOString(),
    })),
  };
  res.json(body);
});

// Serve the built frontend (present in the production image).
app.use(
  express.static(path.resolve(__dirname, "../../frontend/dist"), {
    setHeaders: (res, filePath) => {
      // The SPA shell must always revalidate; hashed assets keep express's defaults.
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

async function start(): Promise<void> {
  await migrateToLatest();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start();
