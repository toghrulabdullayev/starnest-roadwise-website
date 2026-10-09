import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, databaseUrl } from "../lib/db.ts";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

async function main() {
  const db = createDb();
  await db.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (await db.execute("SELECT name FROM _migrations")).rows.map((r) =>
      String(r.name),
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const tx = await db.transaction("write");
    try {
      await tx.executeMultiple(sql);
      await tx.execute({
        sql: "INSERT INTO _migrations (name) VALUES (?)",
        args: [file],
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      tx.close();
    }
    console.log(`applied ${file}`);
    ran++;
  }
  console.log(
    ran === 0
      ? `no pending migrations (${databaseUrl()})`
      : `${ran} migration(s) applied (${databaseUrl()})`,
  );
  db.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
