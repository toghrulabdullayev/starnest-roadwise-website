import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser, safeNext } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/login", { title: dict.nav.login, index: false, description: dict.meta.pages.login });
}

export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const next = safeNext((await searchParams).next, "", locale);
  if (await getCurrentUser()) redirect(next || `/${locale}/profile`);
  const t = getDictionary(locale).auth;
  return (
    <AuthShell title={t.loginTitle} lead={next ? t.loginToContinue : t.loginLead}>
      <AuthForm mode="login" locale={locale} t={t} next={next || undefined} />
    </AuthShell>
  );
}
