import { createClient, type Client, type InStatement, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * libSQL client singleton. Local dev: DATABASE_URL=file:./data/roadwise.db.
 * Production: libsql://<db>.turso.io with DATABASE_AUTH_TOKEN.
 */
let client: Client | null = null;
let ready: Promise<void> | null = null;

export function databaseUrl(): string {
  return process.env.DATABASE_URL || "file:./data/roadwise.db";
}

function create(): Client {
  const url = databaseUrl();
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    if (file && file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
}

export async function getDb(): Promise<Client> {
  if (!client) {
    client = create();
    ready = client.execute("PRAGMA foreign_keys = ON").then(() => undefined);
  }
  await ready;
  return client;
}

export type Row = Record<string, InValue | undefined>;

export async function query<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const db = await getDb();
  const rs = await db.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function queryOne<T = Row>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({ sql, args });
  return rs.rowsAffected;
}

export async function batch(statements: InStatement[]): Promise<void> {
  const db = await getDb();
  await db.batch(statements, "write");
}

/** For tests and scripts: drop the singleton so a new DATABASE_URL takes effect. */
export function resetDbClient(): void {
  client?.close();
  client = null;
  ready = null;
}
