import { buildExamBrief, type ExamBrief } from "@/lib/exam/adaptive";
import type { Locale } from "@/lib/i18n/config";
import { latestPlan, type StoredPlan } from "@/lib/learning/plans";
import type { FocusEntry } from "@/lib/profile/focus";
import { loadFocus } from "@/lib/profile/load";
import { lastQuizResult } from "@/lib/quiz/store";

export interface LearningData {
  focus: FocusEntry[];
  brief: ExamBrief;
  plan: StoredPlan | null;
  lastQuiz: { correct: number; total: number; answered_at: string } | null;
}

/** Everything the profile's learning sections need. The brief is computed, not stored: viewing the page must not issue one. */
export async function getLearningData(userId: string, locale: Locale): Promise<LearningData> {
  const [{ focus, drivesCount }, plan, lastQuiz] = await Promise.all([
    loadFocus(userId),
    latestPlan(userId, locale),
    lastQuizResult(userId),
  ]);
  return { focus, brief: buildExamBrief({ focus, drivesCount }), plan, lastQuiz };
}
