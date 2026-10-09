"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { locales, localeNames, localeShort, swapLocale, type Locale } from "@/lib/i18n/config";

export function LanguageSwitcher({
  current,
  label,
  onSwitch,
}: {
  current: Locale;
  label: string;
  onSwitch?: (locale: Locale) => Promise<void>;
}) {
  const pathname = usePathname() || `/${current}`;
  const search = useSearchParams().toString();
  return (
    <nav aria-label={label} className="flex items-center">
      <ul className="flex border-2 border-text-on-dark">
        {locales.map((l) => {
          const active = l === current;
          return (
            <li key={l}>
              <Link
                href={`${swapLocale(pathname, l)}${search ? `?${search}` : ""}`}
                hrefLang={l}
                lang={l}
                aria-current={active ? "true" : undefined}
                title={localeNames[l]}
                onClick={() => {
                  if (!active && onSwitch) void onSwitch(l);
                }}
                className={`flex min-h-11 min-w-11 items-center justify-center px-2 font-mono text-sm font-bold transition-colors ${
                  active
                    ? "bg-text-on-dark text-surface"
                    : "text-text-on-dark hover:bg-surface-2"
                }`}
              >
                <span aria-hidden="true">{localeShort[l]}</span>
                <span className="sr-only">{localeNames[l]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
