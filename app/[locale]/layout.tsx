import type { Metadata } from "next";
import { Archivo_Black, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { isLocale, locales } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import "../globals.css";

const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin", "latin-ext"],
  weight: "400",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return { title: dict.meta.title, description: dict.meta.description };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);

  const links = [
    { href: `/${locale}`, label: dict.nav.home },
    { href: `/${locale}/download`, label: dict.nav.download },
    { href: `/${locale}/login`, label: dict.nav.login },
    { href: `/${locale}/signup`, label: dict.nav.signup },
  ];

  return (
    <html
      lang={locale}
      className={`${archivoBlack.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-current px-6 py-4 sm:px-12">
          <nav aria-label={dict.nav.menu} className="flex flex-wrap gap-2 font-mono text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center px-3 uppercase hover:bg-foreground hover:text-background"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Suspense fallback={null}>
            <LanguageSwitcher current={locale} label={dict.language.label} />
          </Suspense>
        </header>
        {children}
      </body>
    </html>
  );
}
