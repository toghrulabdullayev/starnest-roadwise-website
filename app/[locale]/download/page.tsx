import { getDictionary } from "@/lib/i18n/getDictionary";

// Placeholder until step 5.3.
export default async function DownloadPage({ params }: PageProps<"/[locale]/download">) {
  const dict = getDictionary((await params).locale);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl uppercase">{dict.nav.download}</h1>
    </div>
  );
}
