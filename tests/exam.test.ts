import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExamBrief,
  EXAM_PROFILES,
  MAX_FOCUS_RULES,
  STRUGGLING_TOTAL_WEIGHT,
} from "../lib/exam/adaptive";
import { compareExamWithBrief } from "../lib/profile/compare";
import {
  faultsFromTelemetry,
  focusFromTelemetry,
  type FocusEntry,
} from "../lib/profile/focus";
import { parseTelemetry } from "../lib/telemetry/schema";

function fixture(id: string) {
  const parsed = parseTelemetry(
    JSON.parse(readFileSync(join(__dirname, "..", "fixtures", `${id}.json`), "utf8")),
  );
  if (!parsed.ok) throw new Error("bad fixture");
  return parsed.data;
}

const s1 = fixture("progress_series_1");
const s2 = fixture("progress_series_2");
const s3 = fixture("progress_series_3");
/** wrong way + rolled STOP + missed pedestrian, then progress_series_1: four weak rules, about 4.4 weighted faults per typical drive */
const struggling = [fixture("mixed_exam_fail"), s1];

describe("exam brief", () => {
  it("is a standard, general exam without any history", () => {
    const brief = buildExamBrief({ focus: [], drivesCount: 0 });
    expect(brief).toMatchObject({ reason: "no_history", difficulty: "standard", focus_rules: [] });
    expect(brief.target_length_m).toBe(EXAM_PROFILES.standard.target_length_m);
  });

  it("pushes a driver with a clean history harder", () => {
    const brief = buildExamBrief({ focus: [], drivesCount: 3 });
    expect(brief).toMatchObject({ reason: "clean", difficulty: "hard", repeats_per_rule: 1 });
  });

  it("makes a struggling driver's exam shorter and more repetitive", () => {
    const focus = focusFromTelemetry(struggling);
    const total = focus.reduce((n, f) => n + f.weight, 0);
    expect(total).toBeGreaterThanOrEqual(STRUGGLING_TOTAL_WEIGHT);
    const brief = buildExamBrief({ focus, drivesCount: 1 });
    expect(brief).toMatchObject({ reason: "weaknesses", difficulty: "easy", repeats_per_rule: 3 });
    expect(brief.target_length_m).toBeLessThan(EXAM_PROFILES.standard.target_length_m);
  });

  it("targets the heaviest rules, at most three", () => {
    const focus = focusFromTelemetry(struggling);
    expect(focus.length).toBeGreaterThan(MAX_FOCUS_RULES);
    const brief = buildExamBrief({ focus, drivesCount: 1 });
    expect(brief.focus_rules).toHaveLength(MAX_FOCUS_RULES);
    expect(brief.focus_rules.map((r) => r.rule)).toEqual(focus.slice(0, MAX_FOCUS_RULES).map((r) => r.rule));
  });

  it("uses a standard exam for a driver with a few light faults", () => {
    const focus = focusFromTelemetry([s2]);
    const brief = buildExamBrief({ focus, drivesCount: 1 });
    expect(brief.difficulty).toBe("standard");
  });
});

describe("exam comparison", () => {
  it("marks fixed weaknesses improved and lowers their weight", () => {
    const before = focusFromTelemetry([s1]);
    const brief = buildExamBrief({ focus: before, drivesCount: 1 });
    const after = focusFromTelemetry([s1, s3]);
    const comparison = compareExamWithBrief({
      brief,
      exam: faultsFromTelemetry(s3),
      nextFocus: after,
    });
    expect(comparison.worse).toBe(0);
    expect(comparison.improved).toBe(brief.focus_rules.length);
    for (const r of comparison.results) {
      expect(r.next_weight).toBeLessThan(r.previous_weight);
    }
    const next = buildExamBrief({ focus: after, drivesCount: 2 });
    expect(next.focus_rules[0].weight).toBeLessThan(brief.focus_rules[0].weight);
  });

  it("flags a weakness that came back", () => {
    const before = focusFromTelemetry([s2]);
    const brief = buildExamBrief({ focus: before, drivesCount: 1 });
    const exam = fixture("progress_series_1");
    const comparison = compareExamWithBrief({
      brief,
      exam: faultsFromTelemetry(exam),
      nextFocus: focusFromTelemetry([s2, exam]),
    });
    // progress_series_2 leaves speeding as the weakness; progress_series_1 has two speeding faults
    const speeding = comparison.results.find((r) => r.rule === "speeding");
    expect(speeding?.outcome).not.toBe("improved");
    expect(speeding?.faults_in_exam).toBe(2);
  });

  it("calls a repeat with a lower overall weight 'same'", () => {
    const brief = buildExamBrief({
      focus: [{ rule: "give_way", weight: 3, count: 1, last_seen: "2026-10-01T00:00:00Z", trend: "same" }] as FocusEntry[],
      drivesCount: 1,
    });
    const comparison = compareExamWithBrief({
      brief,
      exam: { drive_id: "x", started_at: "2026-10-02T00:00:00Z", faults: [{ rule: "give_way", severity: "minor" }] },
      nextFocus: [{ rule: "give_way", weight: 2.8, count: 2, last_seen: "2026-10-02T00:00:00Z", trend: "improved" }],
    });
    expect(comparison.results[0].outcome).toBe("same");
  });

  it("ignores rules the brief did not target", () => {
    const brief = buildExamBrief({ focus: focusFromTelemetry([s2]), drivesCount: 1 });
    const comparison = compareExamWithBrief({
      brief,
      exam: faultsFromTelemetry(fixture("red_light_runner")),
      nextFocus: focusFromTelemetry([s2, fixture("red_light_runner")]),
    });
    expect(comparison.results.map((r) => r.rule)).toEqual(brief.focus_rules.map((r) => r.rule));
  });
});
