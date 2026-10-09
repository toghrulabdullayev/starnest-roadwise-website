import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await db.execute("PRAGMA foreign_keys = ON");
  const dir = join(__dirname, "..", "..", "db", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.executeMultiple(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

export async function insertUser(
  db: Client,
  overrides: Partial<{ id: string; email: string }> = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
    args: [id, overrides.email ?? `${id}@example.com`, "x", "Test User"],
  });
  return id;
}
