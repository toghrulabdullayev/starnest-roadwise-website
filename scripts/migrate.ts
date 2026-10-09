/**
 * Apply db/migrations/*.sql in order, tracked in _migrations. Idempotent.
 *   npm run db:migrate         apply pending migrations
 *   npm run db:reset           delete the LOCAL database file, then migrate (refuses non-file URLs)
 */
import "./env";
import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { databaseUrl, getDb } from "../lib/db";

export async function migrate(log = console.log): Promise<string[]> {
  const db = await getDb();
  await db.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = new Set((await db.execute("SELECT name FROM _migrations")).rows.map((r) => String(r.name)));
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await db.executeMultiple(`BEGIN;\n${sql}\nINSERT INTO _migrations (name) VALUES ('${file}');\nCOMMIT;`);
    applied.push(file);
    log(`applied ${file}`);
  }
  if (applied.length === 0) log("migrations: up to date");
  return applied;
}

async function main() {
  const url = databaseUrl();
  const target = url.startsWith("file:") ? url : url.replace(/\/\/[^.]+/, "//<db>");
  if (process.argv.includes("--reset")) {
    if (!url.startsWith("file:")) {
      console.error(`db:reset refuses to touch a non-local database (${target}).`);
      process.exit(1);
    }
    const file = path.resolve(url.slice("file:".length));
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
    console.log(`reset ${file}`);
  }
  console.log(`database: ${target}`);
  await migrate();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
