import type { Locale } from "../../i18n/config";
import type { QuizQuestion } from "../../quiz/types";
import type { RuleKey } from "../../rules/catalog";
import type { GenerateJson } from "../gemini";
import { runGrounded } from "../runner";
import { validateGeneratedQuiz } from "./grounding";
import { buildQuizGenInput } from "./input";
import { QUIZ_PROMPT_VERSION, quizSystemPrompt, quizUserMessage } from "./prompt";
import { generatedQuizJsonSchema, MAX_GENERATED } from "./schema";

export const QUIZ_MAX_ATTEMPTS = 2;

export type QuizGenResult = {
  status: "ready" | "fallback";
  questions: QuizQuestion[];
  model: string | null;
  prompt_version: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempts: number;
  validation_errors: string[][];
};

export async function generateQuizQuestions(options: {
  rules: RuleKey[];
  count: number;
  locale: Locale;
  existing?: string[];
  generate?: GenerateJson;
  configured?: boolean;
}): Promise<QuizGenResult> {
  const count = Math.min(Math.max(options.count, 0), MAX_GENERATED);
  const input = buildQuizGenInput(options.rules, count, options.locale, options.existing ?? []);

  const empty = (): QuizGenResult => ({
    status: "fallback",
    questions: [],
    model: null,
    prompt_version: QUIZ_PROMPT_VERSION,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
    attempts: 0,
    validation_errors: [],
  });
  if (count === 0 || input.rules.length === 0) return empty();

  const outcome = await runGrounded<QuizQuestion[]>({
    system: quizSystemPrompt(options.locale),
    buildInput: (errors) => quizUserMessage(input, errors),
    schema: generatedQuizJsonSchema(),
    validate: (raw) => {
      const checked = validateGeneratedQuiz(raw, input);
      return checked.ok
        ? { ok: true, value: checked.questions }
        : { ok: false, errors: checked.errors };
    },
    generate: options.generate,
    configured: options.configured,
    maxAttempts: QUIZ_MAX_ATTEMPTS,
  });

  return {
    status: outcome.status,
    questions: outcome.value ?? [],
    model: outcome.model,
    prompt_version: QUIZ_PROMPT_VERSION,
    input_tokens: outcome.input_tokens,
    output_tokens: outcome.output_tokens,
    latency_ms: outcome.latency_ms,
    attempts: outcome.attempts,
    validation_errors: outcome.validation_errors,
  };
}
