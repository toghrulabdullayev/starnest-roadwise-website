import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetDbClient } from "@/lib/db";
import { migrate } from "@/scripts/migrate";

/** Point lib/db at a fresh temporary SQLite file and migrate it. */
export async function useTempDb(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "roadwise-test-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.DATABASE_AUTH_TOKEN = "";
  resetDbClient();
  await migrate(() => {});
  return process.env.DATABASE_URL;
}
