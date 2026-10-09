import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { requireUser } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { fmt } from "@/lib/i18n/getDictionary";
import { fmtDate } from "@/lib/i18n/format";
import { lastQuizResult } from "@/lib/quiz/store";
import { RULE_KEYS, ruleName } from "@/lib/rules/catalog";
import { Eyebrow } from "@/components/ui";
import { QuizRunner } from "@/components/quiz/QuizRunner";

export async function generateMetadata({ params }: PageProps<"/[locale]/quiz">): Promise<Metadata> {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const dict = getDictionary(locale);
  return pageMetadata(locale, "/quiz", { title: dict.learn.quizTitle, index: false });
}

export default async function QuizPage({ params }: PageProps<"/[locale]/quiz">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const user = await requireUser(locale, `/${locale}/quiz`);
  const dict = getDictionary(locale);
  const t = dict.learn;
  const last = await lastQuizResult(user.id);
  const ruleNames = Object.fromEntries(RULE_KEYS.map((k) => [k, ruleName(k, locale)]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <Link href={`/${locale}/profile`} className="inline-flex min-h-11 w-fit items-center font-bold text-primary-ink underline decoration-2 underline-offset-4">
          ← {t.quizBack}
        </Link>
        <Eyebrow>{t.quizTitle}</Eyebrow>
        <h1 className="text-4xl uppercase leading-tight sm:text-5xl">{t.quizTitle}</h1>
        <p className="text-text-muted">{t.quizLead}</p>
        {last && (
          <p className="font-semibold">{fmt(t.quizLast, { correct: last.correct, total: last.total, date: fmtDate(locale, last.answered_at, false) })}</p>
        )}
      </header>
      <QuizRunner locale={locale} labels={t} ruleNames={ruleNames} />
    </div>
  );
}
