import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ExamBriefCard, ExamComparisonCard, PlanCard, QuizCta, TrendBadge, WeakSpots } from "@/components/profile/LearningCards";
import { QuizRunner } from "@/components/quiz/QuizRunner";
import { buildExamBrief } from "@/lib/exam/adaptive";
import { locales, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import type { StoredPlan } from "@/lib/learning/plans";
import { compareExamWithBrief } from "@/lib/profile/compare";
import { faultsFromTelemetry, focusFromTelemetry } from "@/lib/profile/focus";
import { RULE_KEYS, ruleName } from "@/lib/rules/catalog";
import { fixture } from "./helpers/api";
import { proxy } from "@/proxy";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const focus = focusFromTelemetry([fixture("progress_series_1"), fixture("progress_series_2")]);
const brief = buildExamBrief({ focus, drivesCount: 2 });

const plan = (status: "ready" | "fallback"): StoredPlan => ({
  id: "p1",
  locale: "en",
  status,
  created_at: "2026-10-09T12:00:00.000Z",
  focus,
  practice_tags: [focus[0].rule],
  plan: {
    summary: "Work on what you repeat.",
    priorities: [{ rule: focus[0].rule, why: "You repeat it.", practice: "Practise it on a quiet street." }],
  },
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe.each(locales as readonly Locale[])("learning cards in %s", (locale) => {
  const dict = getDictionary(locale);
  const t = dict.learn;

  it("shows the weak spots with names, counts and trend badges", () => {
    const out = html(createElement(WeakSpots, { focus, locale, dict }));
    expect(out).toContain(ruleName(focus[0].rule, locale));
    expect(out).toContain(t.trend[focus[0].trend]);
    expect(html(createElement(WeakSpots, { focus: [], locale, dict }))).toContain(t.weakEmpty);
  });

  it("shows the plan, its source and a build button", () => {
    const ai = html(createElement(PlanCard, { plan: plan("ready"), focus, locale, dict }));
    expect(ai).toContain(t.planAi);
    expect(ai).toContain("Work on what you repeat.");
    expect(ai).toContain(ruleName(focus[0].rule, locale));
    expect(ai).toContain(t.planRebuild);

    const std = html(createElement(PlanCard, { plan: plan("fallback"), focus, locale, dict }));
    expect(std).toContain(t.planStandard);

    const empty = html(createElement(PlanCard, { plan: null, focus, locale, dict }));
    expect(empty).toContain(t.planEmpty);
    expect(empty).toContain(t.planBuild);
  });

  it("explains that there is nothing to plan without faults", () => {
    const out = html(createElement(PlanCard, { plan: null, focus: [], locale, dict }));
    expect(out).toContain(t.planNothing);
    expect(out).not.toContain("<form");
  });

  it("shows the exam brief for every situation", () => {
    const weak = html(createElement(ExamBriefCard, { brief, locale, dict }));
    expect(weak).toContain(t.examDifficulty[brief.difficulty]);
    expect(weak).toContain(t.examReason.weaknesses);
    expect(weak).toContain(ruleName(brief.focus_rules[0].rule, locale));
    for (const reason of ["no_history", "clean"] as const) {
      const b = buildExamBrief({ focus: [], drivesCount: reason === "clean" ? 3 : 0 });
      const out = html(createElement(ExamBriefCard, { brief: b, locale, dict }));
      expect(out).toContain(t.examReason[reason]);
      expect(out).toContain(t.examFocusNone);
    }
  });

  it("shows the quiz call to action with and without a last result", () => {
    expect(html(createElement(QuizCta, { lastQuiz: null, locale, dict }))).toContain(`/${locale}/quiz`);
    const out = html(createElement(QuizCta, { lastQuiz: { correct: 7, total: 10, answered_at: "2026-10-09T12:00:00.000Z" }, locale, dict }));
    expect(out).toContain("7");
    expect(out).toContain("10");
  });

  it("shows exam comparison outcomes", () => {
    const exam = fixture("mixed_exam_fail");
    const b = buildExamBrief({ focus: focusFromTelemetry([fixture("progress_series_1")]), drivesCount: 1 });
    const comparison = compareExamWithBrief({
      brief: b,
      exam: faultsFromTelemetry(exam),
      nextFocus: focusFromTelemetry([fixture("progress_series_1"), exam]),
    });
    const out = html(createElement(ExamComparisonCard, { comparison: { brief: b, comparison }, locale, dict }));
    for (const r of comparison.results) expect(out).toContain(ruleName(r.rule, locale));
    expect(out).toMatch(new RegExp(Object.values(t.outcome).join("|")));
  });

  it("starts the quiz runner idle with a start button", () => {
    const ruleNames = Object.fromEntries(RULE_KEYS.map((k) => [k, ruleName(k, locale)]));
    const out = html(createElement(QuizRunner, { locale, labels: t, ruleNames }));
    expect(out).toContain(t.quizStart);
    expect(out).not.toContain("<fieldset");
  });
});

describe("trend badge", () => {
  it("never relies on colour alone", () => {
    const dict = getDictionary("en");
    for (const trend of ["improved", "same", "worse"] as const) {
      const out = html(createElement(TrendBadge, { trend, dict }));
      expect(out).toContain(dict.learn.trend[trend]);
      expect(out).toMatch(/[↓→↑]/);
    }
  });
});

describe("quiz page protection", () => {
  it("sends anonymous visitors to log in and returns them to the quiz", () => {
    const res = proxy(new NextRequest("http://localhost:3000/en/quiz"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/en/login");
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("/en/quiz");
  });
});
