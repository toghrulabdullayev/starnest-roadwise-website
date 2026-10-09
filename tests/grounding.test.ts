import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeMetrics } from "@/lib/metrics";
import { computeReadiness } from "@/lib/readiness";
import { computeHistory } from "@/lib/history";
import { parseTelemetry, type DriveTelemetry } from "@/lib/telemetry/schema";
import { buildDebriefInput, type DebriefInput } from "@/lib/instructor/input";
import { validateDebrief } from "@/lib/instructor/grounding";
import { buildFallbackDebrief } from "@/lib/instructor/fallback";
import { runDebriefPipeline } from "@/lib/instructor/pipeline";
import type { LlmClient } from "@/lib/instructor/llm";
import type { Debrief } from "@/lib/prompts/debrief";
import type { Locale } from "@/lib/i18n/config";

const tel = (n: string): DriveTelemetry => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(n);
  return r.data;
};
function inputFor(n: string, locale: Locale = "en", prev: string[] = []): DebriefInput {
  const t = tel(n);
  const metrics = computeMetrics(t);
  const previous = prev.map((p) => computeMetrics(tel(p))).reverse();
  return buildDebriefInput({ telemetry: t, metrics, readiness: computeReadiness([metrics, ...previous]), history: computeHistory(metrics, previous), locale });
}

/** A correct debrief for red_light_runner, written the way the model should. */
function goodRedLight(input: DebriefInput): Debrief {
  const red = input.events.find((e) => e.rule === "red_light" && e.outcome === "fail")!;
  const speed = input.events.find((e) => e.rule === "speeding" && e.outcome === "fail")!;
  const pass = input.events.find((e) => e.outcome === "pass")!;
  return {
    summary: `You ran a red light on ${red.street} at ${red.time}. That is a major fault.`,
    strengths: [{ text: "You stopped correctly at the STOP sign.", event_ids: [pass.id] }],
    issues: [
      { title: "Red light", severity: "major", rule: "red_light", event_ids: [red.id], why_it_matters: "Instant exam fail.", how_to_fix: "Stop on amber." },
      { title: "Speeding", severity: "minor", rule: "speeding", event_ids: [speed.id], why_it_matters: `You drove ${speed.detail!.speed_kmh} km/h where the limit is ${speed.detail!.limit_kmh}.`, how_to_fix: "Watch the speedometer." },
    ],
    progress: null,
    next_drive: { focus: "Signals", mode: "free", drills: ["Stop on amber at every junction."] },
    readiness_comment: `Your score is ${input.readiness.score}.`,
  };
}

describe("grounding validator", () => {
  const input = inputFor("red_light_runner");
  const good = goodRedLight(input);
  const check = (d: unknown) => validateDebrief(JSON.stringify(d), input);
  const kinds = (d: unknown) => {
    const r = check(d);
    return r.ok ? [] : r.errors.map((e) => e.check);
  };

  it("accepts a grounded debrief", () => {
    expect(check(good)).toMatchObject({ ok: true });
  });
  it("1. rejects non-JSON and schema violations", () => {
    expect(validateDebrief("not json", input)).toMatchObject({ ok: false });
    expect(kinds({ ...good, issues: [{ ...good.issues[0], severity: "critical" }] })).toContain("schema");
  });
  it("2. rejects an unknown event id", () => {
    expect(kinds({ ...good, issues: [{ ...good.issues[0], event_ids: ["e99"] }, good.issues[1]] })).toContain("unknown_event");
  });
  it("3. rejects a rule that is not in the input (even if it is a catalog key)", () => {
    expect(kinds({ ...good, issues: [...good.issues, { ...good.issues[1], rule: "wrong_way" }] })).toContain("unknown_rule");
    expect(kinds({ ...good, issues: [{ ...good.issues[0], rule: "tailgating" }] })).toContain("schema");
  });
  it("4. rejects an issue citing a pass and a strength citing a failure", () => {
    const pass = good.strengths[0].event_ids[0];
    expect(kinds({ ...good, issues: [good.issues[0], { ...good.issues[1], event_ids: [pass] }] })).toContain("wrong_event_kind");
    expect(kinds({ ...good, strengths: [{ text: "ok", event_ids: [good.issues[0].event_ids[0]] }] })).toContain("wrong_event_kind");
  });
  it("5. rejects an invented number or time, accepts numbers from the input", () => {
    expect(kinds({ ...good, summary: "You drove 97 km/h." })).toContain("invented_number");
    expect(kinds({ ...good, summary: "At 09:59 you ran the light." })).toContain("invented_number");
    expect(check({ ...good, summary: `Compliance was ${input.metrics.compliance_pct}%.` })).toMatchObject({ ok: true });
  });
  it("6. rejects a debrief that does not cover a major failed check", () => {
    expect(kinds({ ...good, issues: [good.issues[1]] })).toContain("uncovered_major");
  });
});

describe("fallback debrief", () => {
  const all = ["clean_drive", "speeder", "red_light_runner", "nervous", "mixed_exam_fail", "progress_series_1"];
  for (const n of all)
    for (const l of ["en", "ru", "az"] as const)
      it(`${n} (${l}) passes its own validator`, () => {
        const input = inputFor(n, l);
        const r = validateDebrief(JSON.stringify(buildFallbackDebrief(input, l)), input);
        expect(r.ok ? [] : r.errors).toEqual([]);
      });
  it("with history it lists improvements (progress_series_3)", () => {
    const input = inputFor("progress_series_3", "en", ["progress_series_1", "progress_series_2"]);
    const d = buildFallbackDebrief(input, "en");
    expect(d.progress?.improved.length).toBeGreaterThan(0);
    expect(validateDebrief(JSON.stringify(d), input).ok).toBe(true);
  });
  it("is localized and puts the major fault first", () => {
    const ru = buildFallbackDebrief(inputFor("mixed_exam_fail", "ru"), "ru");
    expect(ru.issues[0].rule).toBe("wrong_way");
    expect(ru.summary).toMatch(/[А-Яа-я]/);
    const az = buildFallbackDebrief(inputFor("red_light_runner", "az"), "az");
    expect(az.issues[0].rule).toBe("red_light");
    expect(az.summary).toMatch(/[əğı]/);
  });
});

describe("pipeline: retry and fallback", () => {
  const input = inputFor("red_light_runner");
  const fake = (outputs: (string | Error)[]): LlmClient & { calls: string[] } => {
    const calls: string[] = [];
    return {
      model: "fake-model",
      calls,
      async generate({ input: msg }) {
        calls.push(msg);
        const o = outputs[Math.min(calls.length - 1, outputs.length - 1)];
        if (o instanceof Error) throw o;
        return { text: o, model: "fake-model", input_tokens: 1000, output_tokens: 200, latency_ms: 5 };
      },
    };
  };
  const bad = JSON.stringify({ ...goodRedLight(input), summary: "You drove 97 km/h." });
  const good = JSON.stringify(goodRedLight(input));

  it("first attempt valid → ready", async () => {
    const r = await runDebriefPipeline(input, "en", fake([good]));
    expect(r).toMatchObject({ status: "ready", attempts: 1, input_tokens: 1000, output_tokens: 200 });
  });
  it("rejected → one retry with the errors appended → ready", async () => {
    const client = fake([bad, good]);
    const r = await runDebriefPipeline(input, "en", client);
    expect(r).toMatchObject({ status: "ready", attempts: 2, input_tokens: 2000 });
    expect(client.calls[1]).toContain("contains the number 97");
    expect(r.validation_errors.some((e) => e.includes("[invented_number]"))).toBe(true);
  });
  it("rejected twice → template fallback with stored reasons", async () => {
    const r = await runDebriefPipeline(input, "en", fake([bad, bad]));
    expect(r.status).toBe("fallback");
    expect(r.attempts).toBe(2);
    expect(r.attempt_log[0].raw).toContain("97");
    expect(validateDebrief(JSON.stringify(r.debrief), input).ok).toBe(true);
  });
  it("API error → fallback without retry", async () => {
    const r = await runDebriefPipeline(input, "en", fake([new Error("401 UNAUTHENTICATED")]));
    expect(r).toMatchObject({ status: "fallback", attempts: 1 });
    expect(r.validation_errors[0]).toContain("api_error");
  });
  it("OPENAI_API_KEY unset → localized fallback", async () => {
    const r = await runDebriefPipeline(inputFor("red_light_runner", "ru"), "ru", null);
    expect(r).toMatchObject({ status: "fallback", attempts: 0, model: null });
    expect(r.debrief.summary).toMatch(/[А-Яа-я]/);
  });
});
