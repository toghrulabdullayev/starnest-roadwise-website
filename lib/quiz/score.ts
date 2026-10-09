import type { DriveFaults } from "../profile/focus.ts";
import type { RuleKey } from "../rules/catalog.ts";
import type { Quiz, QuizAnswer, QuizResult } from "./types.ts";

export function scoreQuiz(quiz: Quiz, answers: QuizAnswer[]): QuizResult {
  const chosen = new Map(answers.map((a) => [a.question_id, a.chosen_index]));
  const wrong: QuizResult["wrong"] = [];
  const wrongByRule: QuizResult["wrong_by_rule"] = {};
  let correct = 0;

  for (const q of quiz.questions) {
    if (chosen.get(q.id) === q.correct_index) {
      correct++;
      continue;
    }
    wrong.push({ question_id: q.id, rule: q.rule });
    wrongByRule[q.rule] = (wrongByRule[q.rule] ?? 0) + 1;
  }

  return { correct, total: quiz.questions.length, wrong, wrong_by_rule: wrongByRule };
}

export function quizMistakesAsFaults(
  result: QuizResult,
  quizId: string,
  answeredAt: string,
): DriveFaults {
  return {
    drive_id: quizId,
    started_at: answeredAt,
    faults: result.wrong.map((w) => ({ rule: w.rule as RuleKey, severity: "quiz" as const })),
  };
}
