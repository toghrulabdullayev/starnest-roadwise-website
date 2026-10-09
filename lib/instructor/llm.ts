/**
 * Gemini call via @google/genai `interactions.create` with structured output
 * (response_format: text / application/json / schema), as documented at
 * https://ai.google.dev/gemini-api/docs/structured-output for the installed SDK.
 */
import { GoogleGenAI } from "@google/genai";
import { debriefJsonSchema } from "@/lib/prompts/debrief";

export interface LlmResult {
  text: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

/** Injectable so tests and the eval can run without the network. */
export interface LlmClient {
  readonly model: string;
  generate(args: { system: string; input: string }): Promise<LlmResult>;
}

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const TEMPERATURE = 0.2;

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function createGeminiClient(): LlmClient | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const client = new GoogleGenAI({ apiKey });
  return {
    model,
    async generate({ system, input }) {
      const t0 = Date.now();
      const interaction = await client.interactions.create({
        model,
        input,
        system_instruction: system,
        response_format: { type: "text", mime_type: "application/json", schema: debriefJsonSchema },
        generation_config: { temperature: TEMPERATURE },
        store: false,
      });
      const u = interaction.usage;
      return {
        text: interaction.output_text ?? "",
        model,
        input_tokens: u?.total_input_tokens ?? 0,
        // thinking tokens are billed as output
        output_tokens: (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0),
        latency_ms: Date.now() - t0,
      };
    },
  };
}
