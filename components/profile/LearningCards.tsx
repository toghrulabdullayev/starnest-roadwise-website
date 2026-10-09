import Link from "next/link";
import type { LearningData } from "@/lib/learning/page";
import type { Locale } from "@/lib/i18n/config";
import { fmt, type Dictionary } from "@/lib/i18n/getDictionary";
import { fmtDate, fmtKm, fmtNumber } from "@/lib/i18n/format";
import type { Trend } from "@/lib/profile/focus";
import { ruleName } from "@/lib/rules/catalog";
import { Badge, buttonClass, Card } from "@/components/ui";
import { PlanForm } from "./PlanForm";

type Props = { locale: Locale; dict: Dictionary };

const trendTone = { improved: "success", same: "neutral", worse: "danger" } as const satisfies Record<Trend, string>;
const trendMark = { improved: "↓", same: "→", worse: "↑" } as const satisfies Record<Trend, string>;

export function TrendBadge({ trend, dict }: { trend: Trend; dict: Dictionary }) {
  return (
    <Badge tone={trendTone[trend]}>
      <span aria-hidden="true">{trendMark[trend]} </span>
      {dict.learn.trend[trend]}
    </Badge>
  );
}

export function WeakSpots({ focus, locale, dict }: Props & { focus: LearningData["focus"] }) {
  const t = dict.learn;
  if (focus.length === 0) return <p className="text-text-muted">{t.weakEmpty}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {focus.map((f) => (
        <li key={f.rule} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-2 border-surface bg-canvas px-4 py-3">
          <div className="min-w-0">
            <p className="font-bold">{ruleName(f.rule, locale)}</p>
            <p className="text-sm text-text-muted">{fmt(t.seen, { n: fmtNumber(locale, f.count), date: fmtDate(locale, f.last_seen, false) })}</p>
          </div>
          <TrendBadge trend={f.trend} dict={dict} />
        </li>
      ))}
    </ul>
  );
}

export function PlanCard({ plan, focus, locale, dict }: Props & { plan: LearningData["plan"]; focus: LearningData["focus"] }) {
  const t = dict.learn;
  if (focus.length === 0 && !plan) return <p className="text-text-muted">{t.planNothing}</p>;
  return (
    <Card className="flex flex-col gap-5">
      {plan ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={plan.status === "ready" ? "primary" : "neutral"}>{plan.status === "ready" ? t.planAi : t.planStandard}</Badge>
            <span className="text-sm text-text-muted">{fmt(t.planBuilt, { date: fmtDate(locale, plan.created_at) })}</span>
          </div>
          {plan.plan.priorities.length > 0 && (
            <>
              <p className="max-w-3xl">{plan.plan.summary}</p>
              <ol className="flex list-none flex-col gap-4">
                {plan.plan.priorities.map((p, i) => (
                  <li key={p.rule} className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center bg-primary font-display text-white">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-bold">{ruleName(p.rule, locale)}</p>
                      <p className="text-text-muted">{p.why}</p>
                      <p className="mt-1">
                        <span className="font-bold">{t.planPractice}: </span>
                        {p.practice}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      ) : (
        <p className="text-text-muted">{t.planEmpty}</p>
      )}
      {focus.length > 0 && <PlanForm locale={locale} label={plan ? t.planRebuild : t.planBuild} labels={t} />}
    </Card>
  );
}

export function ExamBriefCard({ brief, locale, dict }: Props & { brief: LearningData["brief"] }) {
  const t = dict.learn;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={brief.difficulty === "hard" ? "danger" : brief.difficulty === "easy" ? "warning" : "neutral"}>{t.examDifficulty[brief.difficulty]}</Badge>
        <p className="text-text-muted">{t.examReason[brief.reason]}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-text-muted">{t.examLength}</dt>
          <dd className="font-display text-3xl tabular-nums">{fmtKm(locale, brief.target_length_m)}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-muted">{t.examRepeats}</dt>
          <dd className="font-display text-3xl tabular-nums">{brief.repeats_per_rule}×</dd>
        </div>
      </dl>
      <div>
        <p className="text-sm text-text-muted">{t.examFocus}</p>
        {brief.focus_rules.length === 0 ? (
          <p>{t.examFocusNone}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {brief.focus_rules.map((r) => (
              <li key={r.rule} className="flex items-center gap-2 border-2 border-surface px-3 py-1">
                <span className="font-semibold">{ruleName(r.rule, locale)}</span>
                <TrendBadge trend={r.trend} dict={dict} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm text-text-muted">{t.examGame}</p>
    </Card>
  );
}

export function QuizCta({ lastQuiz, locale, dict }: Props & { lastQuiz: LearningData["lastQuiz"] }) {
  const t = dict.learn;
  return (
    <Card className="flex flex-col items-start gap-3">
      <h3 className="text-xl uppercase">{t.quizCtaTitle}</h3>
      <p className="max-w-2xl text-text-muted">{t.quizCtaLead}</p>
      {lastQuiz && (
        <p className="font-semibold">{fmt(t.quizLast, { correct: lastQuiz.correct, total: lastQuiz.total, date: fmtDate(locale, lastQuiz.answered_at, false) })}</p>
      )}
      <Link href={`/${locale}/quiz`} className={buttonClass("secondary")}>
        {t.quizCta}
      </Link>
    </Card>
  );
}

export function ExamComparisonCard({
  comparison,
  locale,
  dict,
}: Props & { comparison: NonNullable<Awaited<ReturnType<typeof import("@/lib/exam/briefs").examComparisonFor>>> }) {
  const t = dict.learn;
  const tone = { improved: "success", same: "neutral", worse: "danger" } as const;
  const mark = { improved: "✓", same: "=", worse: "✕" } as const;
  return (
    <ul className="flex flex-col gap-3">
      {comparison.comparison.results.map((r) => (
        <li key={r.rule} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-2 border-surface bg-canvas px-4 py-3">
          <div className="min-w-0">
            <p className="font-bold">{ruleName(r.rule, locale)}</p>
            <p className="text-sm text-text-muted">{r.faults_in_exam === 0 ? t.compareNone : fmt(t.compareFaults, { n: r.faults_in_exam })}</p>
          </div>
          <Badge tone={tone[r.outcome]}>
            <span aria-hidden="true">{mark[r.outcome]} </span>
            {t.outcome[r.outcome]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
