/**
 * Writing rules shared by every model output a user reads (debrief, plan): the site's own terms,
 * local decimal format, and no internal identifiers. The validators enforce the identifier rule
 * with `internalKeys`; `localizeDecimals` fixes the separator after validation.
 */
import type { Locale } from "../i18n/config";
import { RULE_KEYS } from "../rules/catalog";

const TERMS: Record<Locale, string | null> = {
  en: null,
  ru: "Use the site's terms: «поездка» for a drive, «баллы» for readiness points, «км/ч» for speed, «км» for distance, «инструктор» for the instructor.",
  az: "Use the site's terms: «sürüş» for a drive, «bal» for readiness points, «km/saat» for speed, «km» for distance, «təlimatçı» for the instructor.",
};

export function styleRules(locale: Locale): string[] {
  return [
    "Never write JSON field names, keys or codes (for example compliance_rate, not_ready, stop_sign, minors): use the `label` or `name` given next to them in the input.",
    "Write units with the words in `units`.",
    "Do not add durations, distances, counts or other quantities that are not in the input, not even written as words.",
    ...(locale === "en" ? [] : ["Write decimal numbers with a decimal comma, not a decimal point."]),
    ...(TERMS[locale] ? [TERMS[locale]] : []),
  ];
}

/** snake_case identifiers: compliance_rate, not_ready, stop_sign, harsh_per_10min. */
const SNAKE = /(?<![\p{L}\p{N}_])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\p{L}\p{N}_])/gu;
/** Whole words written only in lowercase Latin letters (not fragments of Azerbaijani words). */
const LATIN_WORD = /(?<![\p{L}\p{N}_])[a-z]+(?![\p{L}\p{N}_])/gu;
/** Internal single-word values: never natural as lowercase Latin words in Russian or Azerbaijani text. */
const WORD_KEYS = new Set<string>([
  ...RULE_KEYS.filter((k) => !k.includes("_")),
  ...["majors", "minors", "compliance", "overspeed", "harsh", "composure", "almost", "ready"],
  ...["major", "minor", "pass", "fail", "free", "exam", "improved", "worse", "same"],
]);
/** Readiness component keys that are not ordinary English words either. */
const EN_WORD_KEYS = new Set(["majors", "minors"]);

/** Internal identifiers that leaked into user-facing text. */
export function internalKeys(text: string, locale: Locale): string[] {
  const found = new Set(text.match(SNAKE) ?? []);
  const words = locale === "en" ? EN_WORD_KEYS : WORD_KEYS;
  for (const w of text.match(LATIN_WORD) ?? []) if (words.has(w)) found.add(w);
  return [...found];
}

/** 9.7 → 9,7 for RU/AZ. Skips dotted runs such as dates (07.10.2026). */
const DECIMAL_POINT = /(?<![\d.])(\d+)\.(\d+)(?![.\d])/g;
export function localizeDecimals(text: string, locale: Locale): string {
  return locale === "en" ? text : text.replace(DECIMAL_POINT, "$1,$2");
}
