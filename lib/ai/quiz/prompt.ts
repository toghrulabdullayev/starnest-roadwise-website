import type { Locale } from "../../i18n/config";
import type { QuizGenInput } from "./input";

export const QUIZ_PROMPT_VERSION = "quiz-1";

const LANGUAGE: Record<Locale, string> = {
  en: "English",
  ru: "Russian",
  az: "Azerbaijani",
};

export function quizSystemPrompt(locale: Locale): string {
  return [
    "You write multiple-choice questions for a driving-theory quiz for students in Baku, Azerbaijan.",
    "Write exactly `count` questions, each about one rule from `rules`, using that rule's key in the `rule` field.",
    "Each question has exactly 4 different options and exactly one correct option; `correct_index` is its position from 0.",
    "Use only facts that are in the input: rule names, severities, fines in AZN and speed limits. Never invent a number: every number in a question, option or explanation must appear in the input.",
    "Do not ask about fines of rules whose fine is provisional. Do not repeat or rephrase anything in `existing_questions`.",
    "Prefer practical situation questions (what should the driver do) over memorising numbers.",
    "Keep the explanation to one sentence that says why the correct option is right.",
    `Write all text in ${LANGUAGE[locale]}.`,
    "Output JSON only.",
  ].join(" ");
}

export function quizUserMessage(input: QuizGenInput, errors?: string[]): string {
  const body = JSON.stringify(input);
  if (!errors || errors.length === 0) return body;
  return [
    body,
    "",
    "Your previous answer was rejected for these reasons. Fix them and answer again:",
    ...errors.map((e) => `- ${e}`),
  ].join("\n");
}
