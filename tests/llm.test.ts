import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, DEFAULT_MODEL, generateJson, isAiConfigured } from "@/lib/ai/llm";

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

function mockFetch(status: number, payload: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sentBody = (fn: ReturnType<typeof mockFetch>) =>
  JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.OPENAI_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});

describe("OpenAI client", () => {
  it("is configured only when a key is set", () => {
    expect(isAiConfigured()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("throws AiUnavailableError without a key and never calls the network", async () => {
    delete process.env.OPENAI_API_KEY;
    const fn = mockFetch(200, {});
    await expect(generateJson({ system: "s", input: "i", schema })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("sends a JSON-schema request to a light model and maps the reply and usage", async () => {
    const fn = mockFetch(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
    const out = await generateJson({ system: "sys", input: "in", schema, temperature: 0.3, schemaName: "thing" });

    expect(out).toMatchObject({ text: '{"ok":true}', model: DEFAULT_MODEL, inputTokens: 12, outputTokens: 5 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = sentBody(fn);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "in" },
    ]);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "thing", schema, strict: false } });
  });

  it("uses OPENAI_MODEL and gives reasoning models low effort without a temperature", async () => {
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    const fn = mockFetch(200, { choices: [{ message: { content: "{}" } }] });
    const out = await generateJson({ system: "s", input: "i", schema });
    expect(out.model).toBe("gpt-5.4-mini");
    const body = sentBody(fn);
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("temperature");
    expect(out.inputTokens).toBeNull();
  });

  it("surfaces API errors with the status and message", async () => {
    mockFetch(429, { error: { message: "You have no credits remaining." } });
    await expect(generateJson({ system: "s", input: "i", schema })).rejects.toThrow("openai 429: You have no credits remaining.");
  });
});
