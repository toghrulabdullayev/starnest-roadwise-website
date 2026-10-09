export class AiUnavailableError extends Error {
  constructor(message = "OPENROUTER_API_KEY is not set") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type Thinking = "minimal" | "low" | "medium" | "high";

export type GenerateJsonRequest = {
  system: string;
  input: string;
  schema: unknown;
  temperature?: number;
  thinking?: Thinking;
  schemaName?: string;
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

export const DEFAULT_MODEL = "google/gemini-3.8-flash";
export const DEFAULT_TIMEOUT_MS = 60_000;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function aiModel(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export const generateJson: GenerateJson = async (request) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new AiUnavailableError();
  const model = aiModel();
  const timeout = Number(process.env.OPENROUTER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const started = Date.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-title": "Roadwise",
      ...(process.env.NEXT_PUBLIC_SITE_URL ? { "http-referer": process.env.NEXT_PUBLIC_SITE_URL } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.input },
      ],
      temperature: request.temperature ?? 0.2,
      reasoning: { effort: request.thinking ?? "low" },
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName ?? "reply", schema: request.schema, strict: false },
      },
      provider: { require_parameters: true },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const latencyMs = Date.now() - started;

  const payload = (await response.json().catch(() => ({}))) as ChatCompletion;
  if (!response.ok) {
    throw new Error(`openrouter ${response.status}: ${payload.error?.message ?? response.statusText}`.slice(0, 300));
  }

  return {
    text: payload.choices?.[0]?.message?.content ?? "",
    model,
    inputTokens: payload.usage?.prompt_tokens ?? null,
    outputTokens: payload.usage?.completion_tokens ?? null,
    latencyMs,
  };
};
