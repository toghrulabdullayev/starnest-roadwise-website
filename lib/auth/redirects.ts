import type { Locale } from "../i18n/config";

export const PROTECTED_SEGMENTS = ["profile", "drives", "link"] as const;

export function isProtectedPath(segments: string[]): boolean {
  return (PROTECTED_SEGMENTS as readonly string[]).includes(segments[1] ?? "");
}

export function safeNext(
  next: string | null | undefined,
  locale: Locale,
): string {
  const fallback = `/${locale}/profile`;
  if (!next || next.length > 300) return fallback;
  if (!next.startsWith(`/${locale}/`)) return fallback;
  if (next.includes("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) {
    return fallback;
  }
  const segments = next.split("?")[0].split("/").filter(Boolean);
  const rest = ["login", "signup"];
  if (rest.includes(segments[1] ?? "")) return fallback;
  return next;
}

export function loginRedirectUrl(
  locale: Locale,
  pathname: string,
  search: string,
): string {
  const next = `${pathname}${search}`;
  return `/${locale}/login?next=${encodeURIComponent(next)}`;
}
