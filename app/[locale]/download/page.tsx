import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { fmt, getDictionary } from "@/lib/i18n/getDictionary";
import { buttonClass, Card, Eyebrow, withBrand } from "@/components/ui";

// The game build is a static file on Google Drive.
const DOWNLOAD_URL = "https://drive.google.com/file/d/1o-KVIi5WvCOcUGRE0Ry0nqSIBVhO1jz_/view?usp=sharing";

export async function generateMetadata({ params }: PageProps<"/[locale]/download">): Promise<Metadata> {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/download", { title: dict.download.title, index: true, description: dict.meta.pages.download });
}

export default async function DownloadPage({ params }: PageProps<"/[locale]/download">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  const t = dict.download;
  const version = process.env.NEXT_PUBLIC_GAME_VERSION;

  return (
    <div className="flex flex-col">
      <section className="on-dark bg-surface text-text-on-dark">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-14 sm:px-6">
          <Eyebrow onDark>{withBrand("Roadwise")}</Eyebrow>
          <h1 className="text-4xl uppercase sm:text-5xl">{withBrand(t.title)}</h1>
          <p className="max-w-2xl text-lg text-text-on-dark-muted">{t.lead}</p>
          <div className="flex flex-wrap items-center gap-4">
            <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "border-text-on-dark text-lg")}>
              ↓ {t.button}
            </a>
            <div className="text-sm text-text-on-dark-muted">
              {version && <p>{fmt(t.version, { version })}</p>}
              <p>{t.releases}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="steps" className="flex flex-col gap-4">
          <h2 id="steps" className="text-3xl uppercase">
            {t.stepsTitle}
          </h2>
          <ol className="flex flex-col gap-4">
            {t.steps.map((s, i) => (
              <li key={s} className="flex gap-4 border-2 border-surface bg-canvas p-4 shadow-bold-sm">
                <span className="flex size-10 shrink-0 items-center justify-center bg-primary font-display text-xl text-white">{i + 1}</span>
                <span className="pt-1.5">{s}</span>
              </li>
            ))}
          </ol>
          <p>
            {t.noAccount}{" "}
            <Link href={`/${locale}/signup`} className="font-bold text-primary-ink underline decoration-2 underline-offset-4">
              {dict.auth.signupButton}
            </Link>
          </p>
        </section>
        <Card as="section" className="h-fit border-warning">
          <h2 className="text-xl uppercase">⚠ {t.unsignedTitle}</h2>
          <p className="mt-2">{t.unsignedBody}</p>
        </Card>
      </div>
    </div>
  );
}
