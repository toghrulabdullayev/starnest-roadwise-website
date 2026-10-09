import { randomUUID } from "node:crypto";
import { batch, query, queryOne } from "@/lib/db";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import type { DriveFaults, FocusEntry } from "@/lib/profile/focus";
import { buildQuiz } from "@/lib/quiz/build";
import { quizMistakesAsFaults, scoreQuiz } from "@/lib/quiz/score";
import type { Quiz, QuizAnswer, QuizQuestion, QuizResult } from "@/lib/quiz/types";
import type { RuleKey } from "@/lib/rules/catalog";

export const QUIZ_FOCUS_WINDOW = 5;

export type PublicQuestion = Pick<QuizQuestion, "id" | "rule" | "text" | "options">;

export interface PublicQuiz {
  quiz_id: string;
  locale: Locale;
  weak_rules: RuleKey[];
  questions: PublicQuestion[];
}

export async function startQuiz(userId: string, locale: Locale, focus: FocusEntry[]): Promise<PublicQuiz> {
  const dict = await getDictionary(locale);
  const quiz = buildQuiz({
    locale,
    dictionary: dict.quiz,
    focus,
    seed: Math.floor(Math.random() * 2 ** 31),
  });
  const id = randomUUID();
  await batch([
    {
      sql: "INSERT INTO quiz_attempts (id, user_id, locale, questions, weak_rules, total) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, userId, locale, JSON.stringify(quiz.questions), JSON.stringify(quiz.weak_rules), quiz.questions.length],
    },
  ]);
  return {
    quiz_id: id,
    locale,
    weak_rules: quiz.weak_rules,
    questions: quiz.questions.map(({ id: qid, rule, text, options }) => ({ id: qid, rule, text, options })),
  };
}

export interface AnsweredQuiz {
  quiz_id: string;
  correct: number;
  total: number;
  results: { question_id: string; rule: RuleKey; correct: boolean; chosen_index: number | null; correct_index: number; explanation: string }[];
}

export type AnswerOutcome =
  | { ok: true; quiz: AnsweredQuiz }
  | { ok: false; error: "not_found" | "already_answered" };

export async function submitQuiz(userId: string, quizId: string, answers: QuizAnswer[]): Promise<AnswerOutcome> {
  const row = await queryOne<{ locale: Locale; questions: string; answered_at: string | null }>(
    "SELECT locale, questions, answered_at FROM quiz_attempts WHERE id = ? AND user_id = ?",
    [quizId, userId],
  );
  if (!row) return { ok: false, error: "not_found" };
  if (row.answered_at) return { ok: false, error: "already_answered" };

  const questions = JSON.parse(row.questions) as QuizQuestion[];
  const quiz: Quiz = { id: quizId, locale: row.locale, questions, weak_rules: [] };
  const result = scoreQuiz(quiz, answers);
  const chosen = new Map(answers.map((a) => [a.question_id, a.chosen_index]));
  const wrongIds = new Set(result.wrong.map((w) => w.question_id));

  await batch([
    {
      sql: "UPDATE quiz_attempts SET answered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), correct = ? WHERE id = ? AND answered_at IS NULL",
      args: [result.correct, quizId],
    },
    ...questions.map((q) => ({
      sql: "INSERT INTO quiz_answers (attempt_id, question_id, rule, chosen_index, is_correct) VALUES (?, ?, ?, ?, ?)",
      args: [quizId, q.id, q.rule, chosen.get(q.id) ?? null, wrongIds.has(q.id) ? 0 : 1],
    })),
  ]);

  return {
    ok: true,
    quiz: {
      quiz_id: quizId,
      correct: result.correct,
      total: result.total,
      results: questions.map((q) => ({
        question_id: q.id,
        rule: q.rule,
        correct: !wrongIds.has(q.id),
        chosen_index: chosen.get(q.id) ?? null,
        correct_index: q.correct_index,
        explanation: q.explanation,
      })),
    },
  };
}

/** Wrong answers of the latest finished quizzes, as pseudo-drives for the weakness profile. */
export async function loadQuizFaults(userId: string, limit = QUIZ_FOCUS_WINDOW): Promise<DriveFaults[]> {
  const attempts = await query<{ id: string; answered_at: string }>(
    "SELECT id, answered_at FROM quiz_attempts WHERE user_id = ? AND answered_at IS NOT NULL ORDER BY answered_at DESC LIMIT ?",
    [userId, limit],
  );
  if (attempts.length === 0) return [];

  const marks = attempts.map(() => "?").join(", ");
  const wrong = await query<{ attempt_id: string; question_id: string; rule: RuleKey }>(
    `SELECT attempt_id, question_id, rule FROM quiz_answers WHERE is_correct = 0 AND attempt_id IN (${marks})`,
    attempts.map((a) => a.id),
  );
  return attempts.map((a) => {
    const result: QuizResult = {
      correct: 0,
      total: 0,
      wrong: wrong.filter((w) => w.attempt_id === a.id).map((w) => ({ question_id: w.question_id, rule: w.rule })),
      wrong_by_rule: {},
    };
    return quizMistakesAsFaults(result, a.id, a.answered_at);
  });
}

export async function lastQuizResult(userId: string): Promise<{ correct: number; total: number; answered_at: string } | null> {
  const row = await queryOne<{ correct: number; total: number; answered_at: string }>(
    "SELECT correct, total, answered_at FROM quiz_attempts WHERE user_id = ? AND answered_at IS NOT NULL ORDER BY answered_at DESC LIMIT 1",
    [userId],
  );
  return row ? { correct: Number(row.correct), total: Number(row.total), answered_at: row.answered_at } : null;
}
