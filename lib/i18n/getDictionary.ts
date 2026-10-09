import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import az from "@/messages/az.json";
import { isLocale, defaultLocale, type Locale } from "./config";

export type Dictionary = typeof en;

// RU/AZ must have the same shape as EN; a missing key is a type error here.
const dictionaries: Record<Locale, Dictionary> = { en, ru, az };

export function getDictionary(locale: string): Dictionary {
  return dictionaries[isLocale(locale) ? locale : defaultLocale];
}

/**
 * Pick a plural form from "form|form|…" for the number (Intl.PluralRules order:
 * en/az "one|other", ru "one|few|many|other"). A string without "|" is used for every number.
 */
export function plural(locale: string, forms: string, n: number): string {
  const parts = forms.split("|");
  if (parts.length === 1) return forms;
  const order = isLocale(locale) && locale === "ru" ? ["one", "few", "many", "other"] : ["one", "other"];
  const i = order.indexOf(new Intl.PluralRules(locale === "az" ? "az" : locale).select(n));
  return parts[Math.min(i < 0 ? order.length - 1 : i, parts.length - 1)];
}

/** Fill "{name}" placeholders. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
