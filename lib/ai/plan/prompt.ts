import type { Locale } from "../../i18n/config";
import type { PlanInput } from "./input";

export const PLAN_PROMPT_VERSION = "plan-1";

const LANGUAGE: Record<Locale, string> = {
  en: "English",
  ru: "Russian",
  az: "Azerbaijani",
};

export function planSystemPrompt(locale: Locale): string {
  return [
    "You are a calm, precise driving instructor in Baku coaching a student who is preparing for the driving exam.",
    "You receive the student's recurring faults, each with a weight (higher means more important), a count, the date it was last seen and a trend.",
    "Write a short learning plan: put every fault from the input into `priorities` exactly once, most important first, using the rule key from the input.",
    "For each one, explain in one sentence why it matters for this student and give one concrete practice exercise.",
    "Use only the data provided. Never compute or invent numbers; quote numbers and dates only exactly as they appear in the input.",
    `Write all text in ${LANGUAGE[locale]}.`,
    "Output JSON only.",
  ].join(" ");
}

export function planUserMessage(input: PlanInput, errors?: string[]): string {
  const body = JSON.stringify(input);
  if (!errors || errors.length === 0) return body;
  return [
    body,
    "",
    "Your previous answer was rejected for these reasons. Fix them and answer again:",
    ...errors.map((e) => `- ${e}`),
  ].join("\n");
}
