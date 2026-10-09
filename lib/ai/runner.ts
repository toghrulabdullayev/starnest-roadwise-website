import {
  AiUnavailableError,
  generateJson,
  isAiConfigured,
  type GenerateJson,
  type Thinking,
} from "./llm";

export type RunnerOutcome<T> = {
  status: "ready" | "fallback";
  value: T | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempts: number;
  validation_errors: string[][];
};

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export async function runGrounded<T>(options: {
  system: string;
  buildInput: (errors?: string[]) => string;
  schema: unknown;
  validate: (raw: string) => Validation<T>;
  generate?: GenerateJson;
  configured?: boolean;
  maxAttempts?: number;
  temperature?: number;
  thinking?: Thinking;
}): Promise<RunnerOutcome<T>> {
  const generate = options.generate ?? generateJson;
  const configured = options.configured ?? isAiConfigured();
  const maxAttempts = options.maxAttempts ?? 2;

  const outcome: RunnerOutcome<T> = {
    status: "fallback",
    value: null,
    model: null,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
    attempts: 0,
    validation_errors: [],
  };

  if (!configured) {
    outcome.validation_errors.push(["ai_unavailable"]);
    return outcome;
  }

  let errors: string[] | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    outcome.attempts = attempt;
    let text: string;
    try {
      const out = await generate({
        system: options.system,
        input: options.buildInput(errors),
        schema: options.schema,
        temperature: options.temperature ?? 0.2,
        thinking: options.thinking,
      });
      text = out.text;
      outcome.model = out.model;
      outcome.input_tokens = (outcome.input_tokens ?? 0) + (out.inputTokens ?? 0);
      outcome.output_tokens = (outcome.output_tokens ?? 0) + (out.outputTokens ?? 0);
      outcome.latency_ms = (outcome.latency_ms ?? 0) + out.latencyMs;
    } catch (err) {
      outcome.validation_errors.push([
        err instanceof AiUnavailableError
          ? "ai_unavailable"
          : `request_failed: ${err instanceof Error ? err.message : String(err)}`,
      ]);
      return outcome;
    }

    const checked = options.validate(text);
    if (checked.ok) {
      outcome.status = "ready";
      outcome.value = checked.value;
      return outcome;
    }
    errors = checked.errors;
    outcome.validation_errors.push(checked.errors);
  }
  return outcome;
}
