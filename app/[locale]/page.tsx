import { getDictionary } from "@/lib/i18n/getDictionary";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return (
    <section className="on-dark bg-surface px-4 py-16 text-text-on-dark sm:px-6">
      <h1 className="mx-auto max-w-6xl text-5xl uppercase">{dict.meta.title}</h1>
    </section>
  );
}
