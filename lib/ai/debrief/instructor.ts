import type { Locale } from "../../i18n/config";
import type { Dictionary } from "../../i18n/getDictionary";
import type { DriveTelemetry } from "../../telemetry/schema.ts";
import {
  AiUnavailableError,
  generateJson,
  isAiConfigured,
  type GenerateJson,
} from "../gemini.ts";
import { buildFallbackDebrief } from "./fallback.ts";
import { validateDebrief } from "./grounding.ts";
import { buildDebriefInput, type DebriefInput } from "./input.ts";
import { PROMPT_VERSION, systemPrompt, userMessage } from "./prompt.ts";
import { debriefJsonSchema, type Debrief } from "./schema.ts";

export const MAX_ATTEMPTS = 2;

export type DebriefResult = {
  status: "ready" | "fallback";
  debrief: Debrief;
  input: DebriefInput;
  model: string | null;
  prompt_version: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempts: number;
  validation_errors: string[][];
};

export async function generateDebrief(options: {
  telemetry: DriveTelemetry;
  locale: Locale;
  generate?: GenerateJson;
  configured?: boolean;
  dictionary?: Dictionary["debrief"];
}): Promise<DebriefResult> {
  const { telemetry, locale } = options;
  const generate = options.generate ?? generateJson;
  const configured = options.configured ?? isAiConfigured();
  const input = buildDebriefInput(telemetry, locale);

  const result: DebriefResult = {
    status: "fallback",
    debrief: undefined as unknown as Debrief,
    input,
    model: null,
    prompt_version: PROMPT_VERSION,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
    attempts: 0,
    validation_errors: [],
  };

  if (configured) {
    const schema = debriefJsonSchema();
    let errors: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      result.attempts = attempt;
      let text: string;
      try {
        const out = await generate({
          system: systemPrompt(locale),
          input: userMessage(input, errors),
          schema,
          temperature: 0.2,
        });
        text = out.text;
        result.model = out.model;
        result.input_tokens = (result.input_tokens ?? 0) + (out.inputTokens ?? 0);
        result.output_tokens = (result.output_tokens ?? 0) + (out.outputTokens ?? 0);
        result.latency_ms = (result.latency_ms ?? 0) + out.latencyMs;
      } catch (err) {
        const message =
          err instanceof AiUnavailableError
            ? "ai_unavailable"
            : `request_failed: ${err instanceof Error ? err.message : String(err)}`;
        result.validation_errors.push([message]);
        break;
      }

      const checked = validateDebrief(text, input);
      if (checked.ok) {
        result.status = "ready";
        result.debrief = checked.debrief;
        return result;
      }
      errors = checked.errors;
      result.validation_errors.push(checked.errors);
    }
  } else {
    result.validation_errors.push(["ai_unavailable"]);
  }

  const dictionary =
    options.dictionary ??
    (await import("../../i18n/getDictionary")).getDictionary(locale).then((d) => d.debrief);
  result.debrief = buildFallbackDebrief(input, locale, await dictionary);
  return result;
}
