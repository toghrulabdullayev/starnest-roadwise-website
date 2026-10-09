/**
 * Debrief pipeline: LLM → grounding validator → one retry with the errors → template fallback.
 * Pure apart from the injected LLM client, so the eval harness runs it directly.
 */
import { PROMPT_VERSION, type Debrief } from "@/lib/prompts/debrief";
import type { Locale } from "@/lib/i18n/config";
import { buildFallbackDebrief } from "./fallback";
import { validateDebrief, type GroundingError } from "./grounding";
import type { DebriefInput } from "./input";
import { requestDebrief } from "./instructor";
import type { LlmClient } from "./llm";

export const MAX_ATTEMPTS = 2;

export interface AttemptRecord {
  attempt: number;
  ok: boolean;
  errors: GroundingError[];
  /** raw model output (kept for failure examples in the eval report) */
  raw: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface PipelineResult {
  status: "ready" | "fallback";
  debrief: Debrief;
  model: string | null;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  attempts: number;
  attempt_log: AttemptRecord[];
  /** why the AI output was not used (validator reasons, API errors) */
  validation_errors: string[];
}

export async function runDebriefPipeline(input: DebriefInput, locale: Locale, client: LlmClient | null): Promise<PipelineResult> {
  const log: AttemptRecord[] = [];
  const reasons: string[] = [];
  const totals = { input_tokens: 0, output_tokens: 0, latency_ms: 0 };
  const done = (status: PipelineResult["status"], debrief: Debrief): PipelineResult => ({
    status,
    debrief,
    model: client?.model ?? null,
    prompt_version: PROMPT_VERSION,
    ...totals,
    attempts: log.length,
    attempt_log: log,
    validation_errors: reasons,
  });

  if (!client) {
    reasons.push("OPENAI_API_KEY not configured");
    return done("fallback", buildFallbackDebrief(input, locale));
  }

  let previous: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { result } = await requestDebrief(client, input, locale, attempt, previous);
      totals.input_tokens += result.input_tokens;
      totals.output_tokens += result.output_tokens;
      totals.latency_ms += result.latency_ms;
      const check = validateDebrief(result.text, input);
      log.push({
        attempt,
        ok: check.ok,
        errors: check.ok ? [] : check.errors,
        raw: result.text,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        latency_ms: result.latency_ms,
      });
      if (check.ok) return done("ready", check.debrief);
      previous = check.errors.map((e) => e.message);
      reasons.push(...check.errors.map((e) => `attempt ${attempt} [${e.check}] ${e.message}`));
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      log.push({ attempt, ok: false, errors: [], raw: "", input_tokens: 0, output_tokens: 0, latency_ms: 0 });
      reasons.push(`attempt ${attempt} [api_error] ${message}`);
      break; // API failures (auth, quota, network) are not fixed by retrying with feedback
    }
  }
  return done("fallback", buildFallbackDebrief(input, locale));
}
