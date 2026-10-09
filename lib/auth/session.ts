import { createHash, randomBytes } from "node:crypto";
import type { Client } from "@libsql/client";
import { getDb } from "../db";
import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };
export const SESSION_DAYS = 30;
export const RENEW_BELOW_DAYS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  locale: "en" | "ru" | "az";
};

export type SessionOptions = { db?: Client; now?: Date };

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_DAYS * DAY_MS);
}

export async function createSession(
  userId: string,
  options: SessionOptions & { userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const token = generateToken();
  const expiresAt = expiryFrom(now);
  await db.execute({
    sql: "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      crypto.randomUUID(),
      userId,
      hashToken(token),
      expiresAt.toISOString(),
      now.toISOString(),
      options.userAgent?.slice(0, 256) ?? null,
    ],
  });
  return { token, expiresAt };
}

export type ValidatedSession = {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
  renewed: boolean;
};

export async function validateSession(
  token: string | undefined | null,
  options: SessionOptions = {},
): Promise<ValidatedSession | null> {
  if (!token) return null;
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const result = await db.execute({
    sql: `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name, u.locale
          FROM auth_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;

  const sessionId = String(row.session_id);
  let expiresAt = new Date(String(row.expires_at));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    await db.execute({ sql: "DELETE FROM auth_sessions WHERE id = ?", args: [sessionId] });
    return null;
  }

  let renewed = false;
  if (expiresAt.getTime() - now.getTime() < RENEW_BELOW_DAYS * DAY_MS) {
    expiresAt = expiryFrom(now);
    await db.execute({
      sql: "UPDATE auth_sessions SET expires_at = ? WHERE id = ?",
      args: [expiresAt.toISOString(), sessionId],
    });
    renewed = true;
  }

  return {
    user: {
      id: String(row.id),
      email: String(row.email),
      display_name: String(row.display_name),
      locale: String(row.locale) as SessionUser["locale"],
    },
    sessionId,
    expiresAt,
    renewed,
  };
}

export async function deleteSession(
  token: string | undefined | null,
  options: SessionOptions = {},
): Promise<void> {
  if (!token) return;
  const db = options.db ?? getDb();
  await db.execute({
    sql: "DELETE FROM auth_sessions WHERE token_hash = ?",
    args: [hashToken(token)],
  });
}

export async function deleteUserSessions(
  userId: string,
  options: SessionOptions = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db.execute({
    sql: "DELETE FROM auth_sessions WHERE user_id = ?",
    args: [userId],
  });
}
