import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

async function ProfileContent({ params }: PageProps<"/[locale]/profile">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const user = await requireUser(locale, `/${locale}/profile`);
  const dict = await getDictionary(locale);

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12 sm:px-12">
      <h1 className="font-display text-4xl uppercase leading-none sm:text-6xl">
        {dict.profile.title}
      </h1>
      <p className="font-mono text-lg">
        {dict.profile.welcome.replace("{name}", user.display_name)}
      </p>
    </main>
  );
}

export default function ProfilePage(props: PageProps<"/[locale]/profile">) {
  return (
    <Suspense fallback={null}>
      <ProfileContent {...props} />
    </Suspense>
  );
}
