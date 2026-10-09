import { intlLocale, type Locale } from "./config";

export function fmtNumber(locale: Locale, n: number, digits = 0): string {
  return new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}
export function fmtPercent(locale: Locale, share: number | null): string {
  if (share === null) return "—";
  return new Intl.NumberFormat(intlLocale[locale], { style: "percent", maximumFractionDigits: 0 }).format(share);
}
export function fmtAzn(locale: Locale, n: number): string {
  return `${fmtNumber(locale, n)} AZN`;
}
export function fmtKm(locale: Locale, metres: number): string {
  return `${fmtNumber(locale, metres / 1000, 1)} km`;
}
export function fmtDate(locale: Locale, iso: string, withTime = true): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Baku",
  }).format(new Date(iso));
}
export function fmtShortDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlLocale[locale], { day: "numeric", month: "short", timeZone: "Asia/Baku" }).format(new Date(iso));
}
export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
