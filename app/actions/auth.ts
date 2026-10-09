"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale, defaultLocale, type Locale } from "@/lib/i18n/config";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { loginLimiter, signupLimiter } from "@/lib/auth/rateLimit";
import { SESSION_COOKIE, createSession, deleteSession } from "@/lib/auth/session";
import { safeNext, sessionCookieOptions, getCurrentUser } from "@/lib/auth/currentUser";
import {
  EmailTakenError,
  createUser,
  displayNameSchema,
  emailSchema,
  findUserByEmail,
  passwordSchema,
  setUserLocale,
} from "@/lib/auth/users";
import { clientIp, userAgent } from "@/lib/request";

/** Error codes; the form translates them with the dictionary. */
export type AuthFormState = {
  error?: "invalid_credentials" | "rate_limited" | "email_taken" | "generic";
  fields?: Partial<Record<"email" | "password" | "displayName", "invalid_email" | "password_short" | "name_required">>;
  values?: { email?: string; displayName?: string };
};

function localeOf(formData: FormData): Locale {
  const l = formData.get("locale");
  return isLocale(l) ? l : defaultLocale;
}

async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(userId, await userAgent());
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = localeOf(formData);
  const values = { email: String(formData.get("email") ?? ""), displayName: String(formData.get("displayName") ?? "") };
  const parsed = z
    .object({ email: emailSchema, password: passwordSchema, displayName: displayNameSchema })
    .safeParse({ email: values.email, password: formData.get("password") ?? "", displayName: values.displayName });
  if (!parsed.success) {
    const fields: AuthFormState["fields"] = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (k === "email") fields.email = "invalid_email";
      if (k === "password") fields.password = "password_short";
      if (k === "displayName") fields.displayName = "name_required";
    }
    return { fields, values };
  }
  if (!signupLimiter.hit(await clientIp()).allowed) return { error: "rate_limited", values };
  let userId: string;
  try {
    userId = (await createUser({ ...parsed.data, locale })).id;
  } catch (err) {
    if (err instanceof EmailTakenError) return { error: "email_taken", values };
    console.error("signup failed", err);
    return { error: "generic", values };
  }
  await startSession(userId);
  redirect(`/${locale}/profile`);
}

export async function logInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = localeOf(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"), `/${locale}/profile`, locale);
  const values = { email };
  const key = `${email}|${await clientIp()}`;
  if (!loginLimiter.hit(key).allowed) return { error: "rate_limited", values };

  const user = email ? await findUserByEmail(email) : null;
  // Spend the same time whether or not the email exists.
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) return { error: "invalid_credentials", values };

  loginLimiter.reset(key);
  await startSession(user.id);
  redirect(next);
}

export async function logOutAction(formData: FormData): Promise<void> {
  const store = await cookies();
  await deleteSession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect(`/${localeOf(formData)}`);
}

/** Language switcher: remember the choice on the account (used for new debriefs). */
export async function setLocaleAction(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const user = await getCurrentUser();
  if (user && user.locale !== locale) await setUserLocale(user.id, locale);
}

/** Profile: explicit debrief-language preference; also switches the site to that language. */
export async function setPreferredLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get("preferred");
  const user = await getCurrentUser();
  if (!user || !isLocale(locale)) return;
  await setUserLocale(user.id, locale);
  redirect(`/${locale}/profile?saved=1`);
}
