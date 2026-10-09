/**
 * Debrief prompt + output schema (roadwise-ai-instructor §5).
 * Bump PROMPT_VERSION on any change to the prompt, input shape or schema, then rerun `npm run eval`.
 */
import { z } from "zod";
import { RULE_KEYS } from "@/lib/rules/catalog";
import type { Locale } from "@/lib/i18n/config";

export const PROMPT_VERSION = "debrief-v1";

export const LANGUAGE_NAME: Record<Locale, string> = { en: "English", ru: "Russian", az: "Azerbaijani" };

export function systemPrompt(locale: Locale): string {
  return [
    "You are a calm, precise driving instructor in Baku preparing a student for the driving exam.",
    "Use only the data provided.",
    "Every issue must cite at least one event id from `events` and one rule key from `rules`.",
    "Issues are about failed rule checks (outcome \"fail\"); strengths may cite passed checks (outcome \"pass\") or none.",
    "Never compute or invent numbers; quote numbers only as they appear in the input (times as mm:ss exactly as given).",
    "Order issues by safety: major before minor, repeated before one-off. Cover every major failed check.",
    "Give concrete, actionable advice tied to the street and moment of each event.",
    "`progress` must be null when `history` is null; otherwise list what improved and what got worse using the history directions.",
    "`readiness_comment` explains the given readiness score through its largest components; do not recompute it.",
    `Write all text in ${LANGUAGE_NAME[locale]}.`,
    "Output JSON only.",
  ].join("\n");
}

/** Strict validation of the model output (grounding check 1). */
export const debriefSchema = z.object({
  summary: z.string().min(1).max(1200),
  strengths: z.array(z.object({ text: z.string().min(1).max(400), event_ids: z.array(z.string()) })).max(5),
  issues: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        severity: z.enum(["major", "minor"]),
        rule: z.enum(RULE_KEYS),
        event_ids: z.array(z.string()).min(1),
        why_it_matters: z.string().min(1).max(600),
        how_to_fix: z.string().min(1).max(600),
      }),
    )
    .max(8),
  progress: z.object({ improved: z.array(z.string().max(300)), worse: z.array(z.string().max(300)) }).nullable(),
  next_drive: z.object({
    focus: z.string().min(1).max(300),
    mode: z.enum(["free", "exam"]),
    drills: z.array(z.string().min(1).max(300)).min(1).max(5),
  }),
  readiness_comment: z.string().min(1).max(600),
});
export type Debrief = z.infer<typeof debriefSchema>;

/** JSON Schema sent as response_format.schema — only keywords the structured-output docs list. */
export const debriefJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2–3 sentences" },
    strengths: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: { text: { type: "string" }, event_ids: { type: "array", items: { type: "string" } } },
        required: ["text", "event_ids"],
      },
    },
    issues: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["major", "minor"] },
          rule: { type: "string", enum: [...RULE_KEYS] },
          event_ids: { type: "array", items: { type: "string" }, minItems: 1 },
          why_it_matters: { type: "string" },
          how_to_fix: { type: "string" },
        },
        required: ["title", "severity", "rule", "event_ids", "why_it_matters", "how_to_fix"],
      },
    },
    progress: {
      type: ["object", "null"],
      properties: {
        improved: { type: "array", items: { type: "string" } },
        worse: { type: "array", items: { type: "string" } },
      },
      required: ["improved", "worse"],
    },
    next_drive: {
      type: "object",
      properties: {
        focus: { type: "string" },
        mode: { type: "string", enum: ["free", "exam"] },
        drills: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      },
      required: ["focus", "mode", "drills"],
    },
    readiness_comment: { type: "string" },
  },
  required: ["summary", "strengths", "issues", "progress", "next_drive", "readiness_comment"],
} as const;
