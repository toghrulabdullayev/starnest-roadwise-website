import Link from "next/link";
import { headers } from "next/headers";
import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { buttonClass, Eyebrow } from "@/components/ui";

export default async function NotFound() {
  const fromUrl = (await headers()).get("x-locale");
  const locale = isLocale(fromUrl) ? fromUrl : defaultLocale;
  const t = getDictionary(locale).notFound;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-5 px-4 py-20 sm:px-6">
      <Eyebrow>404</Eyebrow>
      <h1 className="text-4xl uppercase sm:text-5xl">{t.title}</h1>
      <p className="max-w-xl text-lg text-text-muted">{t.body}</p>
      <Link href={`/${locale}`} className={buttonClass("primary")}>
        {t.home}
      </Link>
    </div>
  );
}
