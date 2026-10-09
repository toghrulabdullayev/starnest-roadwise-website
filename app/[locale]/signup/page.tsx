import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  return { title: getDictionary((await params).locale).nav.signup };
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
