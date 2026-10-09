import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, queryOne, run } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { MIN_PASSWORD_LENGTH, hashPassword } from "./password";

export interface User {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(200);
export const displayNameSchema = z.string().trim().min(1).max(60);

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    display_name: String(row.display_name),
    locale: isLocale(row.locale) ? row.locale : "en",
  };
}

export async function findUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT id, email, display_name, locale, password_hash FROM users WHERE email = ?",
    [email.trim().toLowerCase()],
  );
  return row ? { ...toUser(row), password_hash: String(row.password_hash) } : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT id, email, display_name, locale FROM users WHERE id = ?", [id]);
  return row ? toUser(row) : null;
}

export class EmailTakenError extends Error {}

export async function createUser(input: { email: string; password: string; displayName: string; locale: Locale }): Promise<User> {
  const email = emailSchema.parse(input.email);
  const id = randomUUID();
  const hash = await hashPassword(input.password);
  try {
    await run("INSERT INTO users (id, email, password_hash, display_name, locale) VALUES (?, ?, ?, ?, ?)", [
      id,
      email,
      hash,
      input.displayName.trim(),
      input.locale,
    ]);
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new EmailTakenError();
    throw err;
  }
  return { id, email, display_name: input.displayName.trim(), locale: input.locale };
}

export async function setUserLocale(userId: string, locale: Locale): Promise<void> {
  await run("UPDATE users SET locale = ? WHERE id = ?", [locale, userId]);
}

/** Changing the password signs out every session (roadwise-web §5). */
export async function changePassword(userId: string, newPassword: string): Promise<void> {
  await run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(newPassword), userId]);
  await run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
}

export async function listUsers(): Promise<User[]> {
  return (await query<Record<string, unknown>>("SELECT id, email, display_name, locale FROM users")).map(toUser);
}
