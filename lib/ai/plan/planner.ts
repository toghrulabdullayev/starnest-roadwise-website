import type { Locale } from "../../i18n/config";
import type { FocusEntry } from "../../profile/focus";
import type { RuleKey } from "../../rules/catalog";
import type { GenerateJson } from "../llm";
import { runGrounded } from "../runner";
import { localizeDecimals } from "../style";
import { ruleTips } from "../tips";
import { buildFallbackPlan, type PlanDictionary } from "./fallback";
import { validatePlan } from "./grounding";
import { buildPlanInput, type PlanInput } from "./input";
import { PLAN_PROMPT_VERSION, planSystemPrompt, planUserMessage } from "./prompt";
import { planJsonSchema, type LearningPlan } from "./schema";

export const PLAN_MAX_ATTEMPTS = 2;

export type PlanResult = {
  status: "ready" | "fallback";
  plan: LearningPlan;
  practice_tags: RuleKey[];
  input: PlanInput;
  model: string | null;
  prompt_version: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempts: number;
  validation_errors: string[][];
};

export async function generateLearningPlan(options: {
  focus: FocusEntry[];
  locale: Locale;
  generate?: GenerateJson;
  configured?: boolean;
  dictionary?: PlanDictionary;
}): Promise<PlanResult> {
  const { locale } = options;
  const input = buildPlanInput(options.focus, locale);

  const outcome =
    input.focus.length === 0
      ? null
      : await runGrounded<LearningPlan>({
          system: planSystemPrompt(locale),
          buildInput: (errors) => planUserMessage(input, errors),
          schema: planJsonSchema(),
          validate: (raw) => {
            const checked = validatePlan(raw, input, locale);
            return checked.ok
              ? { ok: true, value: checked.plan }
              : { ok: false, errors: checked.errors };
          },
          generate: options.generate,
          configured: options.configured,
          maxAttempts: PLAN_MAX_ATTEMPTS,
        });

  const t = (s: string) => localizeDecimals(s, locale);
  let plan: LearningPlan | null = outcome?.value
    ? {
        summary: t(outcome.value.summary),
        priorities: outcome.value.priorities.map((p) => ({ ...p, why: t(p.why), practice: t(p.practice) })),
      }
    : null;
  if (!plan) {
    let dictionary = options.dictionary;
    if (!dictionary) {
      const dict = await (await import("../../i18n/getDictionary")).getDictionary(locale);
      dictionary = { locale, plan: dict.plan, tips: ruleTips(dict) };
    }
    plan = buildFallbackPlan(input, dictionary);
  }

  return {
    status: outcome?.status ?? "fallback",
    plan,
    practice_tags: plan.priorities.map((p) => p.rule),
    input,
    model: outcome?.model ?? null,
    prompt_version: PLAN_PROMPT_VERSION,
    input_tokens: outcome?.input_tokens ?? null,
    output_tokens: outcome?.output_tokens ?? null,
    latency_ms: outcome?.latency_ms ?? null,
    attempts: outcome?.attempts ?? 0,
    validation_errors: outcome?.validation_errors ?? [],
  };
}
