import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fontVariables } from "@/lib/fonts";
import { isLocale, locales } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: { default: dict.meta.title, template: "%s · Roadwise" }, description: dict.meta.description };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader locale={locale} dict={dict} user={await getCurrentUser()} />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <footer className="on-dark border-t-4 border-primary bg-surface text-text-on-dark-muted">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm sm:px-6">
            <p lang="en" className="font-display text-text-on-dark">Roadwise</p>
            <p>{dict.footer.tagline}</p>
            {locale !== "en" && <p>{dict.footer.provisional}</p>}
          </div>
        </footer>
      </body>
    </html>
  );
}
