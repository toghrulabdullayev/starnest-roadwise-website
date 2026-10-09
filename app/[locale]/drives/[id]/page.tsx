import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/currentUser";
import { getDebrief, getDrive } from "@/lib/drives/queries";
import { isLocale, defaultLocale, localeNames } from "@/lib/i18n/config";
import { fmt, getDictionary } from "@/lib/i18n/getDictionary";
import { fmtAzn, fmtDate, fmtDuration, fmtKm } from "@/lib/i18n/format";
import { RULE_KEYS, ruleName, type RuleKey } from "@/lib/rules/catalog";
import { buildTrace } from "@/lib/trace";
import { mmss } from "@/lib/instructor/input";
import { resolveStalePending } from "@/lib/instructor/store";
import { examComparisonFor } from "@/lib/exam/briefs";
import { ExamComparisonCard } from "@/components/profile/LearningCards";
import { Badge, Eyebrow } from "@/components/ui";
import { DriveExplorer, type DebriefView, type TimelineItem } from "@/components/drive/DriveExplorer";
import { Deltas, MetricGroups } from "@/components/drive/MetricGroups";
import type { Debrief } from "@/lib/prompts/debrief";

export async function generateMetadata({ params }: PageProps<"/[locale]/drives/[id]">): Promise<Metadata> {
  return { title: getDictionary((await params).locale).drive.title };
}

export default async function DrivePage({ params }: PageProps<"/[locale]/drives/[id]">) {
  const { locale: l, id } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const user = await requireUser(locale, `/${locale}/drives/${id}`);
  const drive = await getDrive(id, user.id, true);
  if (!drive || !drive.telemetry) notFound();
  const dict = getDictionary(locale);
  const t = dict.drive;

  await resolveStalePending(drive.id, locale);
  const { record } = await getDebrief(drive.id, locale);
  const debrief: DebriefView | null = record
    ? { status: record.status, locale: record.locale, content: record.debrief as Debrief | null, model: record.model }
    : null;

  const ruleNames = Object.fromEntries(RULE_KEYS.map((k) => [k, ruleName(k, locale)])) as Record<RuleKey, string>;
  const timeline: TimelineItem[] = drive.telemetry.events
    .map((e): TimelineItem => {
      if (e.type === "checkpoint") return { id: e.id, time: mmss(e.t), kind: "checkpoint", title: fmt(t.checkpoint, { n: e.index + 1 }) };
      const notes: string[] = [];
      if (e.outcome === "fail" && e.fine_azn !== undefined) notes.push(fmtAzn(locale, e.fine_azn));
      if (e.rule === "speeding" && e.detail?.speed_kmh !== undefined) notes.push(`${e.detail.speed_kmh} / ${e.detail.limit_kmh} km/h`);
      return {
        id: e.id,
        time: mmss(e.t),
        kind: e.outcome === "pass" ? "pass" : e.severity === "major" ? "major" : "minor",
        title: e.outcome === "pass" ? dict.instructor.rules[e.rule].topic : ruleNames[e.rule],
        street: e.street,
        note: notes.join(" · ") || undefined,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  const exam = drive.metrics.exam;
  const comparison = await examComparisonFor(drive.id);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4">
        <Link href={`/${locale}/profile`} className="inline-flex min-h-11 w-fit items-center font-bold text-primary-ink underline decoration-2 underline-offset-4">
          ← {t.back}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>{t.title}</Eyebrow>
          {drive.source === "fixture" && <Badge tone="primary">{t.sample}</Badge>}
        </div>
        <h1 className="text-4xl uppercase leading-tight sm:text-5xl">
          {dict.profile.modes[drive.mode]}
          {drive.district ? ` · ${drive.district}` : ""}
        </h1>
        {exam && (
          <p className={`w-fit border-2 px-3 py-1 font-bold uppercase ${exam.passed ? "border-success-ink text-success-ink" : "border-danger-ink text-danger-ink"}`}>
            {exam.passed ? `✓ ${t.passed}` : `✕ ${t.failed}`}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            [t.date, fmtDate(locale, drive.started_at)],
            [t.duration, fmtDuration(drive.duration_s)],
            [t.distance, fmtKm(locale, drive.distance_m)],
            [dict.readiness.bands[drive.readiness.band], `${drive.readiness.score} / 100`],
          ].map(([k, v]) => (
            <div key={k} className="border-2 border-surface bg-canvas p-3 shadow-bold-sm">
              <dt className="text-sm font-semibold text-text-muted">{k}</dt>
              <dd className="font-display text-xl">{v}</dd>
            </div>
          ))}
        </dl>
        {drive.source === "fixture" && <p className="text-sm text-text-muted">{t.sampleNote}</p>}
      </header>

      <DriveExplorer
        driveId={drive.id}
        currentLocale={locale}
        localeNames={localeNames}
        trace={buildTrace(drive.telemetry)}
        timeline={timeline}
        debrief={debrief}
        labels={t}
        ruleNames={ruleNames}
      />

      {comparison && (
        <section aria-labelledby="compare-title" className="flex flex-col gap-4">
          <div>
            <h2 id="compare-title" className="text-2xl uppercase sm:text-3xl">
              {dict.learn.compareTitle}
            </h2>
            <p className="text-text-muted">{dict.learn.compareLead}</p>
          </div>
          <ExamComparisonCard comparison={comparison} locale={locale} dict={dict} />
        </section>
      )}

      <section aria-labelledby="deltas-title" className="flex flex-col gap-4">
        <h2 id="deltas-title" className="text-2xl uppercase sm:text-3xl">
          {t.deltasTitle}
        </h2>
        <Deltas history={drive.history} locale={locale} dict={dict} />
      </section>

      <section aria-labelledby="metrics-title" className="flex flex-col gap-4">
        <div>
          <h2 id="metrics-title" className="text-2xl uppercase sm:text-3xl">
            {t.metricsTitle}
          </h2>
          <p className="text-text-muted">{t.metricsNote}</p>
        </div>
        <MetricGroups m={drive.metrics} locale={locale} dict={dict} />
      </section>
    </div>
  );
}
