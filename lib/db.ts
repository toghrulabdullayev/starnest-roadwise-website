import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client } from "@libsql/client";

const globalForDb = globalThis as unknown as { roadwiseDb?: Client };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./data/roadwise.db";
}

export function isLocalDatabase(url: string = databaseUrl()): boolean {
  return url.startsWith("file:");
}

export function createDb(url: string = databaseUrl()): Client {
  if (isLocalDatabase(url)) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  if (isLocalDatabase(url)) {
    void client.execute("PRAGMA foreign_keys = ON");
  }
  return client;
}

export function getDb(): Client {
  if (!globalForDb.roadwiseDb) {
    globalForDb.roadwiseDb = createDb();
  }
  return globalForDb.roadwiseDb;
}
