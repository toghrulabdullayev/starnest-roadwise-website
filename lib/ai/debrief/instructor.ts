import type { Locale } from "../../i18n/config";
import type { Dictionary } from "../../i18n/getDictionary";
import type { DriveTelemetry } from "../../telemetry/schema.ts";
import type { GenerateJson } from "../gemini.ts";
import { runGrounded } from "../runner.ts";
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
  const input = buildDebriefInput(telemetry, locale);

  const outcome = await runGrounded<Debrief>({
    system: systemPrompt(locale),
    buildInput: (errors) => userMessage(input, errors),
    schema: debriefJsonSchema(),
    validate: (raw) => {
      const checked = validateDebrief(raw, input);
      return checked.ok
        ? { ok: true, value: checked.debrief }
        : { ok: false, errors: checked.errors };
    },
    generate: options.generate,
    configured: options.configured,
    maxAttempts: MAX_ATTEMPTS,
  });

  let debrief = outcome.value;
  if (!debrief) {
    const dictionary =
      options.dictionary ??
      (await (await import("../../i18n/getDictionary")).getDictionary(locale)).debrief;
    debrief = buildFallbackDebrief(input, locale, dictionary);
  }

  return {
    status: outcome.status,
    debrief,
    input,
    model: outcome.model,
    prompt_version: PROMPT_VERSION,
    input_tokens: outcome.input_tokens,
    output_tokens: outcome.output_tokens,
    latency_ms: outcome.latency_ms,
    attempts: outcome.attempts,
    validation_errors: outcome.validation_errors,
  };
}
