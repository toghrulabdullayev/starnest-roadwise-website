import { NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n/config";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const unauthorized = () => json({ error: "unauthorized" }, 401);

/** Read a JSON body; null when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** CSRF guard for cookie-authenticated POST route handlers (roadwise-web §5). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  if (origin === siteUrl()) return true;
  // Also accept the host the request actually arrived on (preview deployments, local ports).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function verifyUrl(userCode: string): string {
  return `${siteUrl()}/${defaultLocale}/link?code=${encodeURIComponent(userCode)}`;
}
