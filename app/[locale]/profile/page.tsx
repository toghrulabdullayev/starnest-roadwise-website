import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/currentUser";
import { getProfileData } from "@/lib/drives/profile";
import { getLearningData } from "@/lib/learning/page";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { fmt, getDictionary } from "@/lib/i18n/getDictionary";
import { fmtShortDate } from "@/lib/i18n/format";
import { buttonClass, Card, Eyebrow } from "@/components/ui";
import { ReadinessCard } from "@/components/profile/ReadinessCard";
import { KpiTiles } from "@/components/profile/KpiTiles";
import { ProgressCharts, type ProgressPoint } from "@/components/profile/ProgressCharts";
import { ViolationBars } from "@/components/profile/ViolationBars";
import { ExamHistory } from "@/components/profile/ExamHistory";
import { DriveTable } from "@/components/profile/DriveTable";
import { Devices } from "@/components/profile/Devices";
import { ExamBriefCard, PlanCard, QuizCta, WeakSpots } from "@/components/profile/LearningCards";
import { LanguagePreference } from "@/components/profile/LanguagePreference";

export async function generateMetadata({ params }: PageProps<"/[locale]/profile">): Promise<Metadata> {
  return { title: getDictionary((await params).locale).nav.profile };
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 id={id} className="text-2xl uppercase sm:text-3xl">
          {title}
        </h2>
        {lead && <p className="text-text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function ProfilePage({ params, searchParams }: PageProps<"/[locale]/profile">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const user = await requireUser(locale, `/${locale}/profile`);
  const dict = getDictionary(locale);
  const t = dict.profile;
  const [data, learning] = await Promise.all([getProfileData(user.id), getLearningData(user.id, locale)]);
  const saved = (await searchParams).saved === "1";

  const points: ProgressPoint[] = data.series.map((d, i) => ({
    n: i + 1,
    label: fmtShortDate(locale, d.started_at),
    compliance: d.compliance_rate === null ? null : Math.round(d.compliance_rate * 100),
    composure: d.composure_index,
    fines: d.fines_total_azn,
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6">
      <header>
        <Eyebrow>{t.title}</Eyebrow>
        <h1 className="mt-2 text-4xl uppercase leading-tight sm:text-5xl">{fmt(t.greeting, { name: user.display_name })}</h1>
        <p className="mt-2 text-text-muted">{t.lead}</p>
      </header>

      {data.latest ? (
        <>
          <ReadinessCard readiness={data.latest.readiness} locale={locale} dict={dict} />
          <KpiTiles totals={data.totals} locale={locale} dict={dict} />
          <div className="grid gap-12 lg:grid-cols-2">
            <Section id="weak" title={dict.learn.weakTitle} lead={dict.learn.weakLead}>
              <WeakSpots focus={learning.focus} locale={locale} dict={dict} />
            </Section>
            <Section id="exam-next" title={dict.learn.examTitle} lead={dict.learn.examLead}>
              <ExamBriefCard brief={learning.brief} locale={locale} dict={dict} />
            </Section>
          </div>
          <Section id="plan" title={dict.learn.planTitle} lead={dict.learn.planLead}>
            <PlanCard plan={learning.plan} focus={learning.focus} locale={locale} dict={dict} />
          </Section>
          <Section id="progress" title={t.progressTitle} lead={t.progressLead}>
            <ProgressCharts data={points} labels={t.chart} />
          </Section>
          <div className="grid gap-12 lg:grid-cols-2">
            <Section id="violations" title={t.violationsTitle}>
              <ViolationBars rows={data.violations} locale={locale} dict={dict} />
            </Section>
            <Section id="exams" title={t.examTitle}>
              <ExamHistory exams={data.exams} locale={locale} dict={dict} />
            </Section>
          </div>
          <Section id="drives" title={t.drivesTitle}>
            <DriveTable drives={[...data.series].reverse()} locale={locale} dict={dict} />
          </Section>
        </>
      ) : (
        <Card>
          <h2 className="text-2xl uppercase">{t.emptyTitle}</h2>
          <p className="mt-2 max-w-2xl text-text-muted">{t.emptyBody}</p>
          <ol className="mt-4 flex list-none flex-col gap-3">
            {t.emptySteps.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center bg-primary font-display text-white">{i + 1}</span>
                <span className="pt-1">{s}</span>
              </li>
            ))}
          </ol>
          <Link href={`/${locale}/download`} className={buttonClass("primary", "mt-6")}>
            {dict.nav.download}
          </Link>
        </Card>
      )}

      <QuizCta lastQuiz={learning.lastQuiz} locale={locale} dict={dict} />

      <div className="grid gap-12 lg:grid-cols-2">
        <Section id="devices" title={t.devicesTitle}>
          <Devices devices={data.devices} locale={locale} dict={dict} />
        </Section>
        <Section id="language" title={t.languageTitle}>
          <LanguagePreference current={user.locale} dict={dict} saved={saved} />
        </Section>
      </div>
    </div>
  );
}
