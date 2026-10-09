import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerateJson } from "../lib/ai/llm";
import { validatePlan } from "../lib/ai/plan/grounding";
import { buildPlanInput } from "../lib/ai/plan/input";
import { generateLearningPlan, PLAN_MAX_ATTEMPTS } from "../lib/ai/plan/planner";
import { locales } from "../lib/i18n/config";
import { focusFromTelemetry } from "../lib/profile/focus";
import { parseTelemetry } from "../lib/telemetry/schema";

function fixture(id: string) {
  const parsed = parseTelemetry(
    JSON.parse(readFileSync(join(__dirname, "..", "fixtures", `${id}.json`), "utf8")),
  );
  if (!parsed.ok) throw new Error("bad fixture");
  return parsed.data;
}

const focus = focusFromTelemetry([fixture("progress_series_1"), fixture("progress_series_2")]);
const input = buildPlanInput(focus, "en");
const rules = input.focus.map((f) => f.rule);

function goodPlan(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Focus on the faults you repeat.",
    priorities: [...rules].reverse().map((rule) => ({
      rule,
      why: "You made this fault recently.",
      practice: "Practise it on a quiet street.",
    })),
    ...overrides,
  };
}

const validate = (p: unknown) => validatePlan(JSON.stringify(p), input);
const errorsOf = (p: unknown) => {
  const r = validate(p);
  return r.ok ? [] : r.errors;
};

function fake(responses: unknown[]) {
  const calls: string[] = [];
  let i = 0;
  const generate: GenerateJson = async (req) => {
    calls.push(req.input);
    const body = responses[Math.min(i++, responses.length - 1)];
    return { text: JSON.stringify(body), model: "fake", inputTokens: 10, outputTokens: 5, latencyMs: 1 };
  };
  return { generate, calls };
}

describe("plan input", () => {
  it("carries localized names, dates and at most five rules", () => {
    expect(input.focus[0].name.length).toBeGreaterThan(0);
    expect(input.focus[0].last_seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const many = buildPlanInput(
      Array.from({ length: 7 }, () => focus[0]),
      "en",
    );
    expect(many.focus).toHaveLength(5);
  });
});

describe("plan grounding", () => {
  it("accepts any order that covers each rule once", () => {
    expect(validate(goodPlan()).ok).toBe(true);
  });

  it("rejects missing, duplicate and foreign rules", () => {
    const missing = goodPlan();
    (missing.priorities as unknown[]).pop();
    expect(errorsOf(missing).join()).toContain("is missing from priorities");

    const dup = goodPlan();
    (dup.priorities as { rule: string }[])[1].rule = (dup.priorities as { rule: string }[])[0].rule;
    expect(errorsOf(dup).join()).toContain("appears more than once");

    const foreign = goodPlan();
    (foreign.priorities as { rule: string }[])[0].rule = "wrong_way";
    expect(errorsOf(foreign).join()).toContain("is not in the input");
  });

  it("rejects invented numbers but allows numbers from the input", () => {
    expect(errorsOf(goodPlan({ summary: "You made 99 mistakes." })).join()).toContain('"99"');
    const count = input.focus[0].count;
    expect(validate(goodPlan({ summary: `You repeated one fault ${count} times.` })).ok).toBe(true);
  });

  it("rejects bad JSON and schema violations", () => {
    expect(validatePlan("nope", input).ok).toBe(false);
    expect(errorsOf({ summary: "x" }).length).toBeGreaterThan(0);
  });
});

describe("generateLearningPlan", () => {
  it("returns the model plan when grounded", async () => {
    const { generate } = fake([goodPlan()]);
    const r = await generateLearningPlan({ focus, locale: "en", generate, configured: true });
    expect(r.status).toBe("ready");
    expect(r.practice_tags.sort()).toEqual([...rules].sort());
  });

  it("retries with errors, then falls back", async () => {
    const bad = goodPlan({ summary: "You made 99 mistakes." });
    const { generate, calls } = fake([bad]);
    const r = await generateLearningPlan({ focus, locale: "en", generate, configured: true });
    expect(r.status).toBe("fallback");
    expect(calls).toHaveLength(PLAN_MAX_ATTEMPTS);
    expect(calls[1]).toContain('number "99" does not appear in the input');
    expect(r.plan.priorities.map((p) => p.rule)).toEqual(rules);
  });

  it("does not call the model without faults", async () => {
    const { generate, calls } = fake([goodPlan()]);
    const r = await generateLearningPlan({ focus: [], locale: "en", generate, configured: true });
    expect(calls).toHaveLength(0);
    expect(r.status).toBe("fallback");
    expect(r.plan.priorities).toEqual([]);
    expect(r.practice_tags).toEqual([]);
  });

  it("falls back without a key", async () => {
    const { generate, calls } = fake([goodPlan()]);
    const r = await generateLearningPlan({ focus, locale: "en", generate, configured: false });
    expect(calls).toHaveLength(0);
    expect(r.validation_errors[0]).toEqual(["ai_unavailable"]);
  });

  it.each(locales)("fallback is grounded and localized in %s", async (locale) => {
    const r = await generateLearningPlan({ focus, locale, configured: false });
    const localInput = buildPlanInput(focus, locale);
    expect(validatePlan(JSON.stringify(r.plan), localInput).ok).toBe(true);
    expect(r.plan.priorities[0].rule).toBe(focus[0].rule);
    if (locale === "ru") expect(r.plan.summary).toMatch(/[А-Яа-я]/);
    if (locale === "az") expect(r.plan.summary).toContain("zəif");
  });
});
