import Image from "next/image";
import Link from "next/link";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { RULE_KEYS, RULES } from "@/lib/rules/catalog";
import { buttonClass, Eyebrow } from "@/components/ui";
import { screens, type ScreenKey } from "@/lib/screens";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  const t = dict.landing;

  return (
    <>
      {/* hero */}
      <section className="on-dark bg-surface text-text-on-dark">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-20">
          <div className="flex flex-col gap-6">
            <Eyebrow onDark>{t.eyebrow}</Eyebrow>
            <h1 className="text-4xl uppercase leading-[1.05] sm:text-5xl lg:text-6xl">{t.title}</h1>
            <p className="max-w-xl text-lg text-text-on-dark-muted">{t.lead}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/${locale}/signup`} className={buttonClass("primary", "border-text-on-dark")}>
                {t.ctaSignup}
              </Link>
              <Link href={`/${locale}/download`} className="inline-flex min-h-11 items-center border-2 border-text-on-dark px-5 py-2 font-bold uppercase tracking-wide hover:bg-surface-2">
                {t.ctaDownload}
              </Link>
            </div>
          </div>
          <div className="relative">
            <div className="max-h-[30rem] overflow-hidden border-2 border-text-on-dark bg-canvas shadow-[8px_8px_0_0_#0077bc]">
              <Image src={screens[locale].debrief} alt={t.heroAlt} priority className="h-auto w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* problem */}
      <section className="border-b-2 border-surface bg-canvas">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 lg:grid-cols-2">
          <h2 className="text-3xl uppercase leading-tight sm:text-4xl">{t.problemTitle}</h2>
          <p className="text-lg text-text-muted">{t.problemBody}</p>
        </div>
      </section>

      {/* how it works */}
      <section aria-labelledby="how" className="bg-canvas-2">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how" className="text-3xl uppercase sm:text-4xl">
            {t.howTitle}
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {t.how.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 border-2 border-surface bg-canvas p-6 shadow-bold">
                <span className="flex size-12 items-center justify-center bg-primary font-display text-2xl text-white">{i + 1}</span>
                <h3 className="text-2xl uppercase">{step.title}</h3>
                <p className="text-text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* screenshots */}
      <section aria-labelledby="shots" className="bg-canvas">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="shots" className="text-3xl uppercase sm:text-4xl">
            {t.shotsTitle}
          </h2>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            {(["readiness", "route", "progress", "debrief"] as ScreenKey[]).map((key) => (
              <figure key={key} className="flex flex-col gap-3">
                <div className={`overflow-hidden border-2 border-surface bg-canvas shadow-bold ${key === "debrief" ? "max-h-80" : ""}`}>
                  <Image src={screens[locale][key]} alt={t.shots[key]} className="h-auto w-full" />
                </div>
                <figcaption className="font-semibold">{t.shots[key]}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* rules */}
      <section aria-labelledby="rules" className="on-dark bg-surface text-text-on-dark">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="rules" className="text-3xl uppercase sm:text-4xl">
            {t.rulesTitle}
          </h2>
          <p className="mt-3 max-w-3xl text-text-on-dark-muted">{t.rulesLead}</p>
          <div className="relative mt-8 overflow-x-auto border-2 border-text-on-dark">
            <table className="w-full min-w-[34rem] text-left">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3">{t.rulesCols.rule}</th>
                  <th scope="col" className="px-4 py-3">{t.rulesCols.severity}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t.rulesCols.fine}</th>
                </tr>
              </thead>
              <tbody>
                {RULE_KEYS.map((k) => {
                  const r = RULES[k];
                  return (
                    <tr key={k} className="border-t border-surface-2">
                      <th scope="row" className="px-4 py-3 font-semibold">{r.names[locale]}</th>
                      <td className="px-4 py-3">
                        {r.severity === null ? t.byBand : r.severity === "major" ? `◆ ${t.major}` : `● ${t.minor}`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {r.fineAzn === null ? "10–300 AZN" : `${r.fineAzn} AZN`}
                        {r.provisionalFine && <span className="ml-2 text-xs text-text-on-dark-muted">({t.provisional})</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-text-on-dark-muted">{t.bandNote}</p>
        </div>
      </section>

      {/* honesty */}
      <section aria-labelledby="honest" className="bg-canvas">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="honest" className="text-3xl uppercase sm:text-4xl">
            {t.honestTitle}
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {t.honest.map((line) => (
              <li key={line} className="flex gap-3 border-l-8 border-secondary bg-canvas-2 p-4">
                <span aria-hidden="true" className="font-bold text-secondary-ink">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* final CTA */}
      <section className="bg-primary text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-3xl uppercase sm:text-4xl">{t.finalTitle}</h2>
            <p className="mt-2 text-lg">{t.finalBody}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/${locale}/signup`} className="inline-flex min-h-11 items-center border-2 border-surface bg-surface px-5 py-2 font-bold uppercase text-text-on-dark shadow-bold-sm hover:bg-surface-2">
              {t.ctaSignup}
            </Link>
            <Link href={`/${locale}/download`} className="inline-flex min-h-11 items-center border-2 border-white px-5 py-2 font-bold uppercase hover:bg-primary-hover">
              {t.ctaDownload}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
