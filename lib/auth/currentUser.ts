import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_MS, validateSession } from "./session";
import type { User } from "./users";
import { isLocale, swapLocale, type Locale } from "@/lib/i18n/config";

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** The signed-in user for this request (cached per request), or null. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await validateSession(token);
  return session?.user ?? null;
});

/**
 * Only same-site relative paths are allowed as a post-login destination. With `locale`, a leading
 * /{locale}/ segment is rewritten to it, so switching language on the login page is kept.
 */
export function safeNext(next: unknown, fallback: string, locale?: Locale): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (!locale || !isLocale(next.split(/[/?]/)[1])) return next;
  const [path, ...rest] = next.split("?");
  return [swapLocale(path, locale), ...rest].join("?");
}

export function loginUrl(locale: Locale, returnTo: string): string {
  return `/${locale}/login?next=${encodeURIComponent(returnTo)}`;
}

/** Real auth check for protected pages; redirects to login and back. */
export async function requireUser(locale: Locale, returnTo: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(locale, returnTo));
  return user;
}

export { SESSION_COOKIE, SESSION_TTL_MS };
