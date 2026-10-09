import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "../i18n/config";
import { SESSION_COOKIE } from "./cookie";
import { loginRedirectUrl } from "./redirects";
import { validateSession, type SessionUser } from "./session";

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await validateSession(token);
  return session?.user ?? null;
});

export async function requireUser(
  locale: Locale,
  pathname: string,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginRedirectUrl(locale, pathname, ""));
  return user;
}
