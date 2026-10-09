/**
 * DB-backed sessions. The cookie holds 32 random bytes; the DB holds only their SHA-256.
 * Pure DB functions (createSession / validateSession / deleteSession) are tested directly;
 * the cookie helpers live in currentUser.ts (server-only).
 */
import { randomUUID } from "node:crypto";
import { queryOne, run } from "@/lib/db";
import { findUserById, type User } from "./users";
import { randomToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "rw_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
  userAgent: string | null = null,
  now = Date.now(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await run("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)", [
    randomUUID(),
    userId,
    sha256(token),
    expiresAt.toISOString(),
    userAgent?.slice(0, 300) ?? null,
  ]);
  return { token, expiresAt };
}

/**
 * Looks the token up; expired sessions are deleted. With < 15 days left the expiry
 * slides to 30 days from now and `renewedUntil` tells the caller to refresh the cookie.
 */
export async function validateSession(
  token: string | undefined | null,
  now = Date.now(),
): Promise<{ user: User; expiresAt: Date; renewedUntil: Date | null } | null> {
  if (!token) return null;
  const hash = sha256(token);
  const row = await queryOne<{ id: string; user_id: string; expires_at: string }>(
    "SELECT id, user_id, expires_at FROM auth_sessions WHERE token_hash = ?",
    [hash],
  );
  if (!row) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= now) {
    await run("DELETE FROM auth_sessions WHERE id = ?", [row.id]);
    return null;
  }
  const user = await findUserById(row.user_id);
  if (!user) return null;
  if (expiresAt.getTime() - now < SESSION_RENEW_BELOW_MS) {
    const renewed = new Date(now + SESSION_TTL_MS);
    await run("UPDATE auth_sessions SET expires_at = ? WHERE id = ?", [renewed.toISOString(), row.id]);
    return { user, expiresAt: renewed, renewedUntil: renewed };
  }
  return { user, expiresAt, renewedUntil: null };
}

export async function deleteSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await run("DELETE FROM auth_sessions WHERE token_hash = ?", [sha256(token)]);
}
