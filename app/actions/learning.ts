"use server";

import { revalidatePath } from "next/cache";
import { aiLimiter } from "@/lib/ai/limits";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { createPlan } from "@/lib/learning/plans";
import { loadFocus } from "@/lib/profile/load";
import { startQuiz, submitQuiz, type AnsweredQuiz, type PublicQuiz } from "@/lib/quiz/store";

export type PlanFormState = { error?: "rate_limited" | "generic"; done?: boolean };

export async function buildPlanAction(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "generic" };
  const l = formData.get("locale");
  const locale = isLocale(l) ? l : defaultLocale;
  if (!aiLimiter("plan", 5, 60_000).hit(user.id).allowed) return { error: "rate_limited" };
  try {
    await createPlan(user.id, locale);
  } catch {
    return { error: "generic" };
  }
  revalidatePath(`/${locale}/profile`);
  return { done: true };
}

export type QuizStart = { ok: true; quiz: PublicQuiz } | { ok: false };
export type QuizSubmit = { ok: true; result: AnsweredQuiz } | { ok: false };

export async function startQuizAction(locale: string): Promise<QuizStart> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  try {
    const { focus } = await loadFocus(user.id);
    return { ok: true, quiz: await startQuiz(user.id, isLocale(locale) ? locale : defaultLocale, focus) };
  } catch {
    return { ok: false };
  }
}

export async function submitQuizAction(
  quizId: string,
  answers: { question_id: string; chosen_index: number }[],
): Promise<QuizSubmit> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const clean = answers
    .filter((a) => typeof a.question_id === "string" && Number.isInteger(a.chosen_index) && a.chosen_index >= 0 && a.chosen_index <= 3)
    .slice(0, 50);
  try {
    const outcome = await submitQuiz(user.id, String(quizId), clean);
    if (!outcome.ok) return { ok: false };
    revalidatePath("/", "layout");
    return { ok: true, result: outcome.quiz };
  } catch {
    return { ok: false };
  }
}
