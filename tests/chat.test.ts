import { describe, expect, it } from "vitest";
import type { GenerateJson } from "../lib/ai/llm";
import { CHAT_LIMIT, chatLimiter } from "../lib/ai/chat/rateLimit";
import { buildChatInput } from "../lib/ai/chat/input";
import { validateChatReply } from "../lib/ai/chat/grounding";
import { answerDrivingQuestion } from "../lib/ai/chat/responder";
import { chatSystemPrompt } from "../lib/ai/chat/prompt";
import { chatRequestSchema } from "../lib/ai/chat/schema";
import { locales } from "../lib/i18n/config";

const baseSnapshot = {
  mode: "free" as const,
  speed_kmh: 72.4,
  limit_kmh: 60,
  street: "Nizami küç.",
  next_sign: "STOP",
  recent_faults: [
    { rule: "speeding" as const, seconds_ago: 40 },
    { rule: "red_light" as const, seconds_ago: 300 },
  ],
};

const request = (overrides: Record<string, unknown> = {}, snapshot: Record<string, unknown> = {}) => ({
  question: "Why did I get a fine?",
  snapshot: { ...baseSnapshot, ...snapshot },
  ...overrides,
});

const examRequest = (question = "What should I do at the STOP sign?", snapshot: Record<string, unknown> = {}) =>
  request({ question }, { mode: "exam", next_instruction: "Turn right in 120 m", recent_faults: [], ...snapshot });

function fake(reply: unknown) {
  const calls: { system: string; input: string }[] = [];
  const generate: GenerateJson = async (req) => {
    calls.push({ system: req.system, input: req.input });
    return { text: JSON.stringify(reply), model: "fake", inputTokens: 20, outputTokens: 10, latencyMs: 5 };
  };
  return { generate, calls };
}

const freeReply = (overrides: Record<string, unknown> = {}) => ({
  kind: "answer",
  answer: "You were going 72 in a 60 zone, so you were speeding.",
  rules: ["speeding"],
  ...overrides,
});

describe("chat request", () => {
  it("accepts a valid request and rejects bad ones", () => {
    expect(chatRequestSchema.safeParse(request()).success).toBe(true);
    expect(chatRequestSchema.safeParse(request({ question: "   " })).success).toBe(false);
    expect(chatRequestSchema.safeParse(request({ question: "x".repeat(301) })).success).toBe(false);
    expect(chatRequestSchema.safeParse(request({}, { speed_kmh: -5 })).success).toBe(false);
    expect(chatRequestSchema.safeParse(request({}, { mode: "race" })).success).toBe(false);
    expect(chatRequestSchema.safeParse(request({}, { recent_faults: [{ rule: "jaywalking", seconds_ago: 1 }] })).success).toBe(false);
  });

  it("builds the model input with localized names and rounded numbers", () => {
    const parsed = chatRequestSchema.parse(request());
    const input = buildChatInput(parsed, "az");
    expect(input.snapshot.speed_kmh).toBe(72);
    expect(input.snapshot.recent_faults[0].name).toBe("Sürət həddinin aşılması");
    expect(input.rules).toHaveLength(7);
  });
});

describe("chat grounding", () => {
  const free = buildChatInput(chatRequestSchema.parse(request()), "en");
  const exam = buildChatInput(chatRequestSchema.parse(examRequest()), "en");
  const check = (input: typeof free, reply: unknown) => validateChatReply(JSON.stringify(reply), input);
  const errors = (input: typeof free, reply: unknown) => {
    const r = check(input, reply);
    return r.ok ? [] : r.errors;
  };

  it("accepts a grounded free answer with numbers from the snapshot", () => {
    expect(check(free, freeReply()).ok).toBe(true);
  });

  it("rejects invented numbers and the wrong kind in a free drive", () => {
    expect(errors(free, freeReply({ answer: "You were going 95." })).join()).toContain('"95"');
    expect(errors(free, freeReply({ kind: "refused" })).join()).toContain('kind must be "answer"');
  });

  it("allows only directions or a refusal in an exam", () => {
    expect(check(exam, { kind: "directions", answer: "Turn right in 120 m.", rules: [] }).ok).toBe(true);
    expect(check(exam, { kind: "refused", answer: "I can only help with directions.", rules: [] }).ok).toBe(true);
    expect(errors(exam, { kind: "answer", answer: "Stop fully.", rules: [] }).join()).toContain("not allowed during an exam");
    expect(errors(exam, { kind: "refused", answer: "No.", rules: ["stop_sign"] }).join()).toContain("rules must be empty");
  });

  it("rejects directions when the game gave none", () => {
    const noDirections = buildChatInput(
      chatRequestSchema.parse(examRequest("Where now?", { next_instruction: undefined })),
      "en",
    );
    expect(errors(noDirections, { kind: "directions", answer: "Go straight.", rules: [] }).join()).toContain("no next_instruction");
  });

  it("rejects bad JSON", () => {
    expect(validateChatReply("nope", free).ok).toBe(false);
  });
});

describe("answerDrivingQuestion", () => {
  it("returns the model answer when grounded", async () => {
    const { generate, calls } = fake(freeReply());
    const out = await answerDrivingQuestion({ body: request(), locale: "en", generate, configured: true });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.status).toBe("ready");
      expect(out.result.reply.rules).toEqual(["speeding"]);
      expect(out.result.attempts).toBe(1);
    }
    expect(calls[0].system).toContain("free drive");
  });

  it("uses the exam prompt and returns a model refusal in an exam", async () => {
    const { generate, calls } = fake({ kind: "refused", answer: "Only directions during the exam.", rules: [] });
    const out = await answerDrivingQuestion({ body: examRequest(), locale: "en", generate, configured: true });
    expect(calls[0].system).toContain("EXAM drive");
    expect(out.ok && out.result.reply.kind).toBe("refused");
  });

  it("never lets a rule hint through in an exam, even if the model gives one", async () => {
    const { generate } = fake({ kind: "answer", answer: "Stop fully at the line.", rules: ["stop_sign"] });
    const out = await answerDrivingQuestion({ body: examRequest(), locale: "en", generate, configured: true });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.status).toBe("fallback");
      expect(out.result.reply.kind).toBe("refused");
      expect(out.result.reply.rules).toEqual([]);
    }
  });

  it("makes one attempt only, then falls back to a canned reply about the last fault", async () => {
    const { generate, calls } = fake(freeReply({ answer: "You were going 95." }));
    const out = await answerDrivingQuestion({ body: request(), locale: "en", generate, configured: true });
    expect(calls).toHaveLength(1);
    expect(out.ok && out.result.status).toBe("fallback");
    if (out.ok) {
      expect(out.result.reply.rules).toEqual(["speeding"]);
      expect(out.result.reply.answer).toContain("Speeding");
    }
  });

  it("answers without the model when no key is set, in every language", async () => {
    for (const locale of locales) {
      const out = await answerDrivingQuestion({ body: request(), locale, configured: false });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.result.attempts).toBe(0);
        expect(out.result.reply.answer.length).toBeGreaterThan(0);
        if (locale === "ru") expect(out.result.reply.answer).toMatch(/[А-Яа-я]/);
      }
    }
  });

  it("gives a generic canned reply when there is no recent fault", async () => {
    const out = await answerDrivingQuestion({ body: request({}, { recent_faults: [] }), locale: "en", configured: false });
    expect(out.ok && out.result.reply.rules).toEqual([]);
  });

  it("reports an invalid request without calling the model", async () => {
    const { generate, calls } = fake(freeReply());
    const out = await answerDrivingQuestion({ body: { question: "" }, locale: "en", generate, configured: true });
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("falls back when the model request fails", async () => {
    const generate: GenerateJson = async () => {
      throw new Error("timeout");
    };
    const out = await answerDrivingQuestion({ body: request(), locale: "en", generate, configured: true });
    expect(out.ok && out.result.status).toBe("fallback");
  });
});

describe("chat prompt and rate limit", () => {
  it("differs between free drive and exam", () => {
    expect(chatSystemPrompt("en", "free")).not.toBe(chatSystemPrompt("en", "exam"));
    expect(chatSystemPrompt("az", "free")).toContain("Azerbaijani");
  });

  it("limits a user to twelve questions a minute", () => {
    const limiter = chatLimiter();
    const key = `user-${Math.random()}`;
    for (let i = 0; i < CHAT_LIMIT; i++) expect(limiter.hit(key).allowed).toBe(true);
    expect(limiter.hit(key).allowed).toBe(false);
    expect(limiter.hit("someone-else").allowed).toBe(true);
  });
});
