/**
 * AI instructor: one Gemini request for a debrief, logged with
 * model, prompt_version, tokens, latency and attempt (roadwise-ai-instructor §5).
 */
import { PROMPT_VERSION, systemPrompt } from "@/lib/prompts/debrief";
import type { Locale } from "@/lib/i18n/config";
import type { DebriefInput } from "./input";
import type { LlmClient, LlmResult } from "./llm";

export interface AttemptLog {
  model: string;
  prompt_version: string;
  locale: Locale;
  attempt: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export function userMessage(input: DebriefInput, previousErrors: string[] = []): string {
  const parts = [
    "Drive data (JSON). Write the debrief for this drive.",
    JSON.stringify(input),
  ];
  if (previousErrors.length) {
    parts.push(
      "Your previous answer was rejected by the validator for these reasons. Fix every one and answer again:",
      previousErrors.map((e) => `- ${e}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

export async function requestDebrief(
  client: LlmClient,
  input: DebriefInput,
  locale: Locale,
  attempt: number,
  previousErrors: string[] = [],
): Promise<{ result: LlmResult; log: AttemptLog }> {
  const result = await client.generate({ system: systemPrompt(locale), input: userMessage(input, previousErrors) });
  const log: AttemptLog = {
    model: result.model,
    prompt_version: PROMPT_VERSION,
    locale,
    attempt,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    latency_ms: result.latency_ms,
  };
  console.log(JSON.stringify({ evt: "debrief_attempt", ...log }));
  return { result, log };
}
