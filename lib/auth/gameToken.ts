import { randomUUID } from "node:crypto";
import { query, queryOne, run } from "@/lib/db";
import { findUserById, type User } from "./users";
import { randomToken, sha256 } from "./tokens";

export const GAME_TOKEN_PREFIX = "rw_";

export async function issueGameToken(userId: string, client: string | null): Promise<string> {
  const token = GAME_TOKEN_PREFIX + randomToken(32);
  await run("INSERT INTO game_tokens (id, user_id, token_hash, client) VALUES (?, ?, ?, ?)", [
    randomUUID(),
    userId,
    sha256(token),
    client,
  ]);
  return token;
}

/** Valid, non-revoked token → its user (and last_used_at is updated). */
export async function validateGameToken(token: string | null | undefined): Promise<User | null> {
  if (!token || !token.startsWith(GAME_TOKEN_PREFIX)) return null;
  const row = await queryOne<{ id: string; user_id: string; revoked_at: string | null }>(
    "SELECT id, user_id, revoked_at FROM game_tokens WHERE token_hash = ?",
    [sha256(token)],
  );
  if (!row || row.revoked_at) return null;
  await run("UPDATE game_tokens SET last_used_at = datetime('now') WHERE id = ?", [row.id]);
  return findUserById(row.user_id);
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** Game API auth: `Authorization: Bearer rw_…`. */
export async function requireGameUser(req: Request): Promise<User | null> {
  return validateGameToken(bearerToken(req));
}

export interface DeviceRow {
  id: string;
  client: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listGameTokens(userId: string): Promise<DeviceRow[]> {
  return query<DeviceRow>(
    "SELECT id, client, created_at, last_used_at FROM game_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    [userId],
  );
}

export async function revokeGameToken(id: string, userId: string): Promise<boolean> {
  return (
    (await run("UPDATE game_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [
      id,
      userId,
    ])) === 1
  );
}
