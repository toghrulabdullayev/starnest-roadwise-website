export const locales = ["en", "ru", "az"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Languages shown in the switcher, each in its own language. */
export const localeNames: Record<Locale, string> = { en: "English", ru: "Русский", az: "Azərbaycanca" };
export const localeShort: Record<Locale, string> = { en: "EN", ru: "RU", az: "AZ" };

/** BCP 47 tags for Intl formatting. */
export const intlLocale: Record<Locale, string> = { en: "en-GB", ru: "ru-RU", az: "az-Latn-AZ" };

/** Pick a supported locale from an Accept-Language header (q-values respected). */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** Replace the locale segment of a pathname (or add one). */
export function swapLocale(pathname: string, locale: Locale): string {
  const parts = pathname.split("/");
  if (isLocale(parts[1])) {
    parts[1] = locale;
    return parts.join("/") || `/${locale}`;
  }
  return `/${locale}${pathname === "/" ? "" : pathname}`;
}
