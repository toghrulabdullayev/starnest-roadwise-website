import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-6 py-16 sm:px-12">
      <h1 className="font-display text-5xl uppercase leading-none sm:text-7xl">
        {dict.home.title}
      </h1>
      <p className="max-w-xl font-mono text-lg">{dict.home.tagline}</p>
    </main>
  );
}
