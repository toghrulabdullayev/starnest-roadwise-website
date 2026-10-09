import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, DEFAULT_MODEL, aiModel, generateJson, isAiConfigured } from "@/lib/ai/llm";

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

function mockFetch(status: number, payload: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sent = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
};

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});

describe("OpenRouter client", () => {
  it("is configured only when a key is set, and defaults to Gemini 3.5 Flash-Lite", () => {
    expect(isAiConfigured()).toBe(true);
    expect(aiModel()).toBe("google/gemini-3.5-flash-lite");
    delete process.env.OPENROUTER_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("throws AiUnavailableError without a key and never calls the network", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fn = mockFetch(200, {});
    await expect(generateJson({ system: "s", input: "i", schema })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("sends a JSON-schema request and maps the reply and usage", async () => {
    const fn = mockFetch(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
    const out = await generateJson({ system: "sys", input: "in", schema, temperature: 0.3, thinking: "minimal", schemaName: "thing" });

    expect(out).toMatchObject({ text: '{"ok":true}', model: DEFAULT_MODEL, inputTokens: 12, outputTokens: 5 });
    const { url, headers, body } = sent(fn);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headers.authorization).toBe("Bearer sk-or-test");
    expect(body.model).toBe("google/gemini-3.5-flash-lite");
    expect(body.temperature).toBe(0.3);
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "in" },
    ]);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "thing", schema, strict: false } });
  });

  it("uses OPENROUTER_MODEL and a low reasoning effort by default", async () => {
    process.env.OPENROUTER_MODEL = "google/gemini-3.8-flash";
    const fn = mockFetch(200, { choices: [{ message: { content: "{}" } }] });
    const out = await generateJson({ system: "s", input: "i", schema });
    expect(out.model).toBe("google/gemini-3.8-flash");
    expect(out.inputTokens).toBeNull();
    expect(sent(fn).body.reasoning).toEqual({ effort: "low" });
  });

  it("surfaces API errors with the status and message", async () => {
    mockFetch(402, { error: { message: "Insufficient credits." } });
    await expect(generateJson({ system: "s", input: "i", schema })).rejects.toThrow("openrouter 402: Insufficient credits.");
  });
});
