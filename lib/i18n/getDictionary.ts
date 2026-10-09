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

/** Fill "{name}" placeholders. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
