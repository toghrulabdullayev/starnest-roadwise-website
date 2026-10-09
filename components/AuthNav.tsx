import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current";
import { logOut } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/getDictionary";

const linkClass =
  "inline-flex min-h-11 items-center px-3 uppercase hover:bg-foreground hover:text-background";

export async function AuthNav({
  locale,
  nav,
}: {
  locale: Locale;
  nav: Dictionary["nav"];
}) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <>
        <Link href={`/${locale}/login`} className={linkClass}>
          {nav.login}
        </Link>
        <Link href={`/${locale}/signup`} className={linkClass}>
          {nav.signup}
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href={`/${locale}/profile`} className={linkClass}>
        {nav.profile}
      </Link>
      <form action={logOut}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className={`${linkClass} uppercase`}>
          {nav.logout}
        </button>
      </form>
    </>
  );
}
