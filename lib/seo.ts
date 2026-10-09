/**
 * Page metadata shared by every localized page: canonical URL, hreflang alternates between the
 * three languages, Open Graph and a per-page description. Private pages (account, quiz, drives,
 * device link, log in / sign up) are marked noindex. URLs are built from NEXT_PUBLIC_SITE_URL.
 */
import type { Metadata } from "next";
import { defaultLocale, locales, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { siteUrl } from "@/lib/http";

const OG_LOCALE: Record<Locale, string> = { en: "en_GB", ru: "ru_RU", az: "az_AZ" };

export function pageMetadata(
  locale: Locale,
  path: string,
  opts: { title?: string; description?: string; index?: boolean } = {},
): Metadata {
  const dict = getDictionary(locale);
  const description = opts.description ?? dict.meta.description;
  const url = `/${locale}${path}`;
  const index = opts.index ?? true;
  return {
    ...(opts.title ? { title: opts.title } : {}),
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(locales.map((l) => [l, `/${l}${path}`])),
        "x-default": `/${defaultLocale}${path}`,
      },
    },
    openGraph: {
      type: "website",
      siteName: "Roadwise",
      url,
      title: opts.title ? `${opts.title} · Roadwise` : dict.meta.title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    },
    ...(index ? {} : { robots: { index: false, follow: false } }),
  };
}

export const metadataBase = () => new URL(siteUrl());
