/**
 * LLM client for the debrief: OpenAI chat completions with a JSON-schema response, through the shared
 * lib/ai/llm.ts call. Injectable (LlmClient) so tests and the eval run without the network.
 */
import { aiModel, generateJson, isAiConfigured } from "@/lib/ai/llm";
import { debriefJsonSchema } from "@/lib/prompts/debrief";

export interface LlmResult {
  text: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface LlmClient {
  readonly model: string;
  generate(args: { system: string; input: string }): Promise<LlmResult>;
}

export const TEMPERATURE = 0.2;

export function llmConfigured(): boolean {
  return isAiConfigured();
}

export function createLlmClient(): LlmClient | null {
  if (!isAiConfigured()) return null;
  return {
    model: aiModel(),
    async generate({ system, input }) {
      const out = await generateJson({
        system,
        input,
        schema: debriefJsonSchema,
        temperature: TEMPERATURE,
        schemaName: "debrief",
      });
      return {
        text: out.text,
        model: out.model,
        input_tokens: out.inputTokens ?? 0,
        output_tokens: out.outputTokens ?? 0,
        latency_ms: out.latencyMs,
      };
    },
  };
}
