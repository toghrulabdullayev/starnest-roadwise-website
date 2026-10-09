import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/signup", { title: dict.nav.signup, index: false, description: dict.meta.pages.signup });
}

export default async function SignupPage({ params }: PageProps<"/[locale]/signup">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  if (await getCurrentUser()) redirect(`/${locale}/profile`);
  const t = getDictionary(locale).auth;
  return (
    <AuthShell title={t.signupTitle} lead={t.signupLead}>
      <AuthForm mode="signup" locale={locale} t={t} />
    </AuthShell>
  );
}
