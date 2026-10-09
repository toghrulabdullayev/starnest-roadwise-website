import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { logIn } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/redirects";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

async function LoginContent({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { next } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : undefined, locale);
  if (await getCurrentUser()) redirect(target);
  const dict = await getDictionary(locale);

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-12 sm:px-12">
      <h1 className="font-display text-4xl uppercase leading-none sm:text-6xl">
        {dict.auth.loginTitle}
      </h1>
      <AuthForm
        mode="login"
        locale={locale}
        next={target}
        action={logIn}
        labels={dict.auth}
        alternateHref={`/${locale}/signup?next=${encodeURIComponent(target)}`}
      />
    </main>
  );
}

export default function LoginPage(props: PageProps<"/[locale]/login">) {
  return (
    <Suspense fallback={null}>
      <LoginContent {...props} />
    </Suspense>
  );
}
