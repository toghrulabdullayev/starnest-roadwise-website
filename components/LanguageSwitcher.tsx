"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, localeNames, type Locale } from "@/lib/i18n/config";

export function LanguageSwitcher({
  current,
  label,
}: {
  current: Locale;
  label: string;
}) {
  const pathname = usePathname();
  const rest = pathname.split("/").slice(2).join("/");

  return (
    <nav aria-label={label} className="flex gap-2 font-mono text-sm">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest ? `/${rest}` : ""}`}
          hrefLang={locale}
          lang={locale}
          aria-current={locale === current ? "true" : undefined}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-current px-3 uppercase ${
            locale === current
              ? "bg-primary text-white"
              : "hover:bg-foreground hover:text-background"
          }`}
          title={localeNames[locale]}
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
