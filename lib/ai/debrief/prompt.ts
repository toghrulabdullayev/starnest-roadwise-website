import type { Locale } from "../../i18n/config";
import type { DebriefInput } from "./input";

export const PROMPT_VERSION = "debrief-1";

const LANGUAGE: Record<Locale, string> = {
  en: "English",
  ru: "Russian",
  az: "Azerbaijani",
};

export function systemPrompt(locale: Locale): string {
  return [
    "You are a calm, precise driving instructor in Baku preparing a student for the driving exam.",
    "Use only the data provided.",
    "Every issue must cite at least one event id from `events` whose outcome is fail, and one rule key from `rules`.",
    "Every strength must cite at least one event id whose outcome is pass.",
    "Never compute or invent numbers; quote numbers only exactly as they appear in the input.",
    "Order issues by safety: major before minor, repeated before one-off. Every major failed check must be covered by an issue.",
    "Give concrete, actionable advice. `progress` must be null because there is no history.",
    `Write all text in ${LANGUAGE[locale]}.`,
    "Output JSON only.",
  ].join(" ");
}

export function userMessage(input: DebriefInput, errors?: string[]): string {
  const body = JSON.stringify(input);
  if (!errors || errors.length === 0) return body;
  return [
    body,
    "",
    "Your previous answer was rejected for these reasons. Fix them and answer again:",
    ...errors.map((e) => `- ${e}`),
  ].join("\n");
}
