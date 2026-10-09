import { GoogleGenAI } from "@google/genai";

export class AiUnavailableError extends Error {
  constructor(message = "GEMINI_API_KEY is not set") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type GenerateJsonRequest = {
  system: string;
  input: string;
  schema: unknown;
  temperature?: number;
};

export type GenerateJsonResult = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export type GenerateJson = (
  request: GenerateJsonRequest,
) => Promise<GenerateJsonResult>;

export const DEFAULT_MODEL = "gemini-3.8-flash";

let client: GoogleGenAI | null = null;

export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export const generateJson: GenerateJson = async (request) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiUnavailableError();
  client ??= new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const started = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: request.input,
    config: {
      systemInstruction: request.system,
      temperature: request.temperature ?? 0.2,
      responseMimeType: "application/json",
      responseJsonSchema: request.schema,
    },
  });
  const latencyMs = Date.now() - started;

  return {
    text: response.text ?? "",
    model,
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    latencyMs,
  };
};
