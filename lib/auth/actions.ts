"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { isLocale, type Locale } from "../i18n/config";
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "./password";
import { loginLimitKey, loginLimiter } from "./rateLimit";
import { safeNext } from "./redirects";
import { SESSION_COOKIE, sessionCookieOptions } from "./cookie";
import { createSession, deleteSession } from "./session";

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "invalid_email"
  | "password_too_short"
  | "password_too_long"
  | "name_required"
  | "too_many_attempts"
  | "generic";

export type AuthState = { error?: AuthErrorCode; email?: string };

let dummyHash: Promise<string> | null = null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function localeFrom(formData: FormData): Locale {
  const value = field(formData, "locale");
  return isLocale(value) ? value : "en";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

async function startSession(userId: string) {
  const h = await headers();
  const { token, expiresAt } = await createSession(userId, {
    userAgent: h.get("user-agent"),
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const locale = localeFrom(formData);
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");
  const displayName = field(formData, "display_name").trim().slice(0, 60);

  if (!isValidEmail(email)) return { error: "invalid_email", email };
  if (!displayName) return { error: "name_required", email };
  const passwordProblem = validatePassword(password);
  if (passwordProblem === "too_short") return { error: "password_too_short", email };
  if (passwordProblem === "too_long") return { error: "password_too_long", email };

  const db = getDb();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await db.execute({
      sql: "INSERT INTO users (id, email, password_hash, display_name, locale) VALUES (?, ?, ?, ?, ?)",
      args: [id, email, passwordHash, displayName, locale],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/UNIQUE|constraint/i.test(message)) return { error: "email_taken", email };
    return { error: "generic", email };
  }

  await startSession(id);
  redirect(safeNext(field(formData, "next"), locale));
}

export async function logIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const locale = localeFrom(formData);
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");

  const limiter = loginLimiter();
  const key = loginLimitKey(email, await clientIp());
  if (!limiter.check(key).allowed) return { error: "too_many_attempts", email };

  const result = await getDb().execute({
    sql: "SELECT id, password_hash FROM users WHERE email = ?",
    args: [email],
  });
  const row = result.rows[0];
  dummyHash ??= hashPassword("roadwise-dummy-password");
  const valid = await verifyPassword(
    password,
    row ? String(row.password_hash) : await dummyHash,
  );
  if (!row || !valid) return { error: "invalid_credentials", email };

  limiter.reset(key);
  await startSession(String(row.id));
  redirect(safeNext(field(formData, "next"), locale));
}

export async function logOut(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const store = await cookies();
  await deleteSession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect(`/${locale}`);
}
