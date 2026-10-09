import Link from "next/link";
import { Suspense } from "react";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import type { User } from "@/lib/auth/users";
import { logOutAction, setLocaleAction } from "@/app/actions/auth";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navLink =
  "flex min-h-11 items-center px-3 font-semibold underline-offset-4 decoration-2 hover:underline";

export function SiteHeader({ locale, dict, user }: { locale: Locale; dict: Dictionary; user: User | null }) {
  const t = dict.nav;
  return (
    <header className="on-dark bg-surface text-text-on-dark">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-text-on-dark focus:px-4 focus:py-3 focus:text-surface"
      >
        {t.skipToContent}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={`/${locale}`} className="flex min-h-11 items-center font-display text-2xl uppercase tracking-tight">
          Road<span className="text-primary-on-dark">wise</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label={t.mainNav} className="flex flex-wrap items-center gap-1">
            <Link href={`/${locale}/download`} className={navLink}>
              {t.download}
            </Link>
            {user ? (
              <>
                <Link href={`/${locale}/profile`} className={navLink}>
                  {t.profile}
                </Link>
                <form action={logOutAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" className={`${navLink} cursor-pointer`}>
                    {t.logout}
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href={`/${locale}/login`} className={navLink}>
                  {t.login}
                </Link>
                <Link
                  href={`/${locale}/signup`}
                  className="flex min-h-11 items-center border-2 border-text-on-dark bg-primary px-4 font-bold uppercase text-white hover:bg-primary-hover"
                >
                  {t.signup}
                </Link>
              </>
            )}
          </nav>
          <Suspense>
            <LanguageSwitcher current={locale} label={t.language} onSwitch={user ? setLocaleAction : undefined} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
