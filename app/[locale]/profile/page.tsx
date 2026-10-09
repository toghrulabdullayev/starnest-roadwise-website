import { requireUser } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";

// Placeholder until step 5.1 builds the dashboard.
export default async function ProfilePage({ params }: PageProps<"/[locale]/profile">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const user = await requireUser(locale, `/${locale}/profile`);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl uppercase">{user.display_name}</h1>
    </div>
  );
}
