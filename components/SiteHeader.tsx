import Link from "next/link";
import { Suspense } from "react";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const t = dict.nav;
  return (
    <header className="on-dark bg-surface text-text-on-dark">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-text-on-dark focus:px-4 focus:py-3 focus:text-surface"
      >
        {t.skipToContent}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={`/${locale}`} className="font-display text-2xl uppercase tracking-tight min-h-11 flex items-center">
          Road<span className="text-primary-on-dark">wise</span>
        </Link>
        <nav aria-label={t.mainNav} className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Link href={`/${locale}/download`} className="flex min-h-11 items-center px-3 font-semibold hover:underline underline-offset-4 decoration-2">
            {t.download}
          </Link>
          <Link href={`/${locale}/login`} className="flex min-h-11 items-center px-3 font-semibold hover:underline underline-offset-4 decoration-2">
            {t.login}
          </Link>
          <Link
            href={`/${locale}/signup`}
            className="flex min-h-11 items-center bg-primary px-4 font-bold text-white hover:bg-primary-hover"
          >
            {t.signup}
          </Link>
        </nav>
        <Suspense>
          <LanguageSwitcher current={locale} label={t.language} />
        </Suspense>
      </div>
    </header>
  );
}
