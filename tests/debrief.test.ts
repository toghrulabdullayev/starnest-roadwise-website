import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerateJson } from "../lib/ai/gemini";
import { validateDebrief } from "../lib/ai/debrief/grounding";
import { buildDebriefInput } from "../lib/ai/debrief/input";
import { generateDebrief, MAX_ATTEMPTS } from "../lib/ai/debrief/instructor";
import { debriefJsonSchema } from "../lib/ai/debrief/schema";
import { locales } from "../lib/i18n/config";
import { parseDriveTelemetry } from "../lib/telemetry/schema";

function fixture(id: string) {
  const parsed = parseDriveTelemetry(
    JSON.parse(readFileSync(join(__dirname, "..", "fixtures", `${id}.json`), "utf8")),
  );
  if (!parsed.ok) throw new Error("bad fixture");
  return parsed.data;
}

const telemetry = fixture("red_light_runner");
const input = buildDebriefInput(telemetry, "en");
const redLight = input.events.find((e) => e.rule === "red_light" && e.outcome === "fail")!;
const stopSign = input.events.find((e) => e.rule === "stop_sign" && e.outcome === "fail")!;
const pass = input.events.find((e) => e.outcome === "pass")!;

function goodDebrief(overrides: Record<string, unknown> = {}) {
  return {
    summary: `You ran a red light at ${redLight.time} and rolled through a STOP sign.`,
    strengths: [{ text: "You stopped correctly at the earlier checks.", event_ids: [pass.id] }],
    issues: [
      {
        title: "Running a red light",
        severity: "major",
        rule: "red_light",
        event_ids: [redLight.id],
        why_it_matters: "A red light is a major fault and fails the exam.",
        how_to_fix: "Start slowing down at amber.",
      },
      {
        title: "Not stopping at STOP",
        severity: "minor",
        rule: "stop_sign",
        event_ids: [stopSign.id],
        why_it_matters: "STOP signs require a full stop.",
        how_to_fix: "Stop at the line and look both ways.",
      },
    ],
    progress: null,
    next_drive: { focus: "Red lights", mode: "free", drills: ["Practise stopping on amber."] },
    ...overrides,
  };
}

const validate = (d: unknown) => validateDebrief(JSON.stringify(d), input);
const errorsOf = (d: unknown) => {
  const r = validate(d);
  return r.ok ? [] : r.errors;
};

describe("debrief input", () => {
  it("contains every failed check and trims passes", () => {
    const fails = input.events.filter((e) => e.outcome === "fail");
    expect(fails).toHaveLength(2);
    expect(input.metrics.fines_total_azn).toBe(140);
    expect(input.metrics.major_count).toBe(1);
    expect(input.metrics.minor_count).toBe(1);
    expect(input.rules.map((r) => r.key).sort()).toEqual(
      ["pedestrian_crossing", "red_light", "stop_sign"].sort(),
    );
  });

  it("formats times as mm:ss and carries no raw samples", () => {
    expect(redLight.time).toMatch(/^\d{2}:\d{2}$/);
    expect(JSON.stringify(input)).not.toContain("samples");
  });
});

describe("grounding validator", () => {
  it("accepts a grounded debrief", () => {
    expect(validate(goodDebrief()).ok).toBe(true);
  });

  it("rejects invalid JSON and schema violations", () => {
    expect(validateDebrief("not json", input).ok).toBe(false);
    expect(errorsOf({ summary: "x" }).length).toBeGreaterThan(0);
  });

  it("rejects an unknown event id", () => {
    const d = goodDebrief();
    (d.issues[0] as { event_ids: string[] }).event_ids = ["e999"];
    expect(errorsOf(d).join()).toContain('unknown event id "e999"');
  });

  it("rejects a rule that is not present in the input", () => {
    const d = goodDebrief();
    (d.issues[1] as { rule: string }).rule = "wrong_way";
    expect(errorsOf(d).join()).toContain("not a rule present in the input");
  });

  it("rejects an issue citing a pass and a strength citing a fail", () => {
    const d = goodDebrief();
    (d.issues[1] as { event_ids: string[] }).event_ids = [pass.id];
    (d.strengths[0] as { event_ids: string[] }).event_ids = [redLight.id];
    const text = errorsOf(d).join("\n");
    expect(text).toContain("not a failed check");
    expect(text).toContain("not a passed check");
  });

  it("rejects an invented number but allows numbers from the input", () => {
    expect(errorsOf(goodDebrief({ summary: "You were fined 777 AZN." })).join()).toContain('"777"');
    expect(validate(goodDebrief({ summary: `You were fined 140 AZN and ran the light at ${redLight.time}.` })).ok).toBe(true);
  });

  it("rejects an uncovered major fault", () => {
    const d = goodDebrief();
    d.issues = [d.issues[1]];
    expect(errorsOf(d).join()).toContain("major failed check");
  });

  it("produces a JSON schema without the $schema key", () => {
    const schema = debriefJsonSchema() as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe("object");
  });
});

function fake(responses: unknown[]): { generate: GenerateJson; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const generate: GenerateJson = async (req) => {
    calls.push(req.input);
    const body = responses[Math.min(i++, responses.length - 1)];
    return {
      text: typeof body === "string" ? body : JSON.stringify(body),
      model: "fake-model",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 10,
    };
  };
  return { generate, calls };
}

describe("generateDebrief", () => {
  it("returns a ready debrief on the first valid answer", async () => {
    const { generate } = fake([goodDebrief()]);
    const r = await generateDebrief({ telemetry, locale: "en", generate, configured: true });
    expect(r.status).toBe("ready");
    expect(r.attempts).toBe(1);
    expect(r.input_tokens).toBe(100);
    expect(r.model).toBe("fake-model");
  });

  it("retries once with the error list, then succeeds", async () => {
    const bad = goodDebrief({ summary: "Fined 777 AZN." });
    const { generate, calls } = fake([bad, goodDebrief()]);
    const r = await generateDebrief({ telemetry, locale: "en", generate, configured: true });
    expect(r.status).toBe("ready");
    expect(r.attempts).toBe(2);
    expect(r.validation_errors).toHaveLength(1);
    expect(calls[1]).toContain('number "777" does not appear in the input');
    expect(r.input_tokens).toBe(200);
  });

  it("falls back after the allowed attempts", async () => {
    const { generate, calls } = fake([goodDebrief({ summary: "Fined 777 AZN." })]);
    const r = await generateDebrief({ telemetry, locale: "en", generate, configured: true });
    expect(r.status).toBe("fallback");
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(r.validation_errors).toHaveLength(MAX_ATTEMPTS);
    expect(r.debrief.issues[0].rule).toBe("red_light");
  });

  it("falls back when the request itself fails", async () => {
    const generate: GenerateJson = async () => {
      throw new Error("503");
    };
    const r = await generateDebrief({ telemetry, locale: "en", generate, configured: true });
    expect(r.status).toBe("fallback");
    expect(r.attempts).toBe(1);
    expect(r.validation_errors[0][0]).toContain("request_failed");
  });

  it("falls back without calling the model when no key is configured", async () => {
    const { generate, calls } = fake([goodDebrief()]);
    const r = await generateDebrief({ telemetry, locale: "en", generate, configured: false });
    expect(r.status).toBe("fallback");
    expect(r.attempts).toBe(0);
    expect(calls).toHaveLength(0);
    expect(r.validation_errors[0]).toEqual(["ai_unavailable"]);
  });
});

describe("fallback debrief", () => {
  it.each(locales)("is valid, grounded and localized in %s", async (locale) => {
    const r = await generateDebrief({ telemetry, locale, configured: false });
    const localInput = buildDebriefInput(telemetry, locale);
    const checked = validateDebrief(JSON.stringify(r.debrief), localInput);
    expect(checked.ok).toBe(true);
    expect(r.debrief.issues[0].rule).toBe("red_light");
    expect(r.debrief.issues[0].severity).toBe("major");
    if (locale === "ru") expect(r.debrief.summary).toMatch(/[А-Яа-я]/);
    if (locale === "az") expect(r.debrief.issues[0].title).toBe("Qırmızı işıqda keçmə");
  });

  it("covers every major fault in every fixture", async () => {
    for (const id of ["speeder", "mixed_exam_fail", "progress_series_1", "clean_drive", "nervous"]) {
      const t = fixture(id);
      const r = await generateDebrief({ telemetry: t, locale: "en", configured: false });
      const checked = validateDebrief(JSON.stringify(r.debrief), buildDebriefInput(t, "en"));
      expect(checked.ok, `${id}: ${checked.ok ? "" : checked.errors.join("; ")}`).toBe(true);
    }
  });

  it("handles a clean drive without issues", async () => {
    const r = await generateDebrief({ telemetry: fixture("clean_drive"), locale: "en", configured: false });
    expect(r.debrief.issues).toEqual([]);
    expect(r.debrief.strengths).toHaveLength(1);
  });
});
