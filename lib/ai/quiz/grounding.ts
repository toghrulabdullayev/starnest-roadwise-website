import { hashString } from "../../random";
import type { QuizQuestion } from "../../quiz/types";
import { ungroundedNumbers } from "../numbers";
import type { QuizGenInput } from "./input";
import { generatedQuizSchema } from "./schema";

export type QuizGenValidation =
  | { ok: true; questions: QuizQuestion[] }
  | { ok: false; errors: string[] };

const normalize = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function validateGeneratedQuiz(raw: string, input: QuizGenInput): QuizGenValidation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["output is not valid JSON"] };
  }
  const parsed = generatedQuizSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".") || "(root)"} ${i.message}`,
      ),
    };
  }

  const errors: string[] = [];
  const { questions } = parsed.data;
  if (questions.length !== input.count) {
    errors.push(`expected exactly ${input.count} questions but got ${questions.length}`);
  }

  const allowedRules = new Set<string>(input.rules.map((r) => r.key));
  const seen = new Set(input.existing_questions.map(normalize));
  const serialized = JSON.stringify(input);

  questions.forEach((q, i) => {
    if (!allowedRules.has(q.rule)) {
      errors.push(`questions.${i}.rule "${q.rule}" is not one of the requested rules`);
    }
    const options = q.options.map(normalize);
    if (new Set(options).size !== options.length) {
      errors.push(`questions.${i} has duplicate options`);
    }
    const key = normalize(q.question);
    if (seen.has(key)) errors.push(`questions.${i} repeats an existing or earlier question`);
    seen.add(key);

    const texts = [q.question, ...q.options, q.explanation];
    for (const n of ungroundedNumbers(texts, serialized)) {
      errors.push(`questions.${i} uses number "${n}" which does not appear in the input`);
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    questions: questions.map((q) => ({
      id: `gen:${hashString(normalize(q.question))}`,
      rule: q.rule,
      text: q.question,
      options: q.options,
      correct_index: q.correct_index,
      explanation: q.explanation,
      source: "generated" as const,
    })),
  };
}
