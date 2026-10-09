export class AiUnavailableError extends Error {
  constructor(message = "OPENAI_API_KEY is not set") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type GenerateJsonRequest = {
  system: string;
  input: string;
  schema: unknown;
  temperature?: number;
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

export const DEFAULT_MODEL = "gpt-4.1-mini";
export const DEFAULT_TIMEOUT_MS = 30_000;
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function aiModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export const generateJson: GenerateJson = async (request) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiUnavailableError();
  const model = aiModel();
  const timeout = Number(process.env.OPENAI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.input },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName ?? "reply", schema: request.schema, strict: false },
    },
  };
  if (isReasoningModel(model)) body.reasoning_effort = "low";
  else body.temperature = request.temperature ?? 0.2;

  const started = Date.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const latencyMs = Date.now() - started;

  const payload = (await response.json().catch(() => ({}))) as ChatCompletion;
  if (!response.ok) {
    throw new Error(`openai ${response.status}: ${payload.error?.message ?? response.statusText}`.slice(0, 300));
  }

  return {
    text: payload.choices?.[0]?.message?.content ?? "",
    model,
    inputTokens: payload.usage?.prompt_tokens ?? null,
    outputTokens: payload.usage?.completion_tokens ?? null,
    latencyMs,
  };
};
