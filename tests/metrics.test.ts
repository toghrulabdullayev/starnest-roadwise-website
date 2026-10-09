import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  composureIndex,
  computeMetrics,
  controlMetrics,
  hesitationStops,
  ruleMetrics,
  sampleDurations,
  smoothnessMetrics,
  speedMetrics,
} from "@/lib/metrics";
import type { DriveTelemetry, RuleCheckEvent, Sample } from "@/lib/telemetry/schema";

/** Build samples at 5 Hz from partial rows. */
function mk(rows: Partial<Sample>[], hz = 5): Sample[] {
  return rows.map((r, i) => ({ t: i / hz, x: 0, z: 0, speed_kmh: 0, limit_kmh: 60, throttle: 0, brake: 0, steer: 0, handbrake: 0, ...r }));
}
const speeds = (...v: number[]) => mk(v.map((speed_kmh) => ({ speed_kmh })));
const check = (e: Partial<RuleCheckEvent> & { id: string }): RuleCheckEvent =>
  ({ t: 0, type: "rule_check", rule: "stop_sign", outcome: "pass", x: 0, z: 0, ...e }) as RuleCheckEvent;

describe("rule metrics", () => {
  const events: DriveTelemetry["events"] = [
    check({ id: "e1", rule: "stop_sign", outcome: "pass" }),
    check({ id: "e2", rule: "speeding", outcome: "fail", severity: "minor", fine_azn: 50 }),
    check({ id: "e3", rule: "speeding", outcome: "fail", severity: "major", fine_azn: 200 }),
    check({ id: "e4", rule: "collision", outcome: "fail", severity: "major", fine_azn: 100 }),
    { id: "e5", t: 1, type: "checkpoint", index: 0 },
  ];
  const r = ruleMetrics(events);
  it("checks_total / checks_passed / compliance_rate (checkpoints ignored)", () => {
    expect(r.checks_total).toBe(4);
    expect(r.checks_passed).toBe(1);
    expect(r.compliance_rate).toBe(0.25);
  });
  it("compliance_rate is null with no checks", () => {
    expect(ruleMetrics([]).compliance_rate).toBeNull();
  });
  it("violations_by_rule counts and sums fines", () => {
    expect(r.violations_by_rule).toEqual({ speeding: { count: 2, fines_azn: 250 }, collision: { count: 1, fines_azn: 100 } });
  });
  it("fines_total_azn, major_count, minor_count, collisions", () => {
    expect(r.fines_total_azn).toBe(350);
    expect(r.major_count).toBe(2);
    expect(r.minor_count).toBe(1);
    expect(r.collisions).toBe(1);
  });
});

describe("speed metrics", () => {
  // 5 samples at 0.2 s: one stationary, then 50, 80 (limit 60 → +20 overspeed), 80, 50
  const s = speeds(0, 50, 80, 80, 50);
  const m = speedMetrics(s, sampleDurations(s, 5));
  it("moving time excludes samples at ≤ 2 km/h", () => {
    expect(m.moving_time_s).toBe(0.8);
  });
  it("overspeed_time_share = time above limit + 11 / moving time", () => {
    expect(m.overspeed_time_share).toBe(0.5);
  });
  it("mean_overspeed_kmh over samples above the limit", () => {
    expect(m.mean_overspeed_kmh).toBe(20);
  });
  it("avg_speed_kmh (time-weighted, moving) and max_speed_kmh", () => {
    expect(m.avg_speed_kmh).toBe(65);
    expect(m.max_speed_kmh).toBe(80);
  });
  it("speed_cv = std / mean of moving speed", () => {
    expect(m.speed_cv).toBe(0.231);
  });
});

describe("smoothness metrics", () => {
  it("harsh_brake_count with 1 s debounce", () => {
    // 50 → 30 km/h in 0.2 s = -27.8 m/s² twice in a row, then again 2 s later
    const s = speeds(50, 30, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0);
    expect(smoothnessMetrics(s).harsh_brake_count).toBe(2);
  });
  it("harsh_accel_count", () => {
    expect(smoothnessMetrics(speeds(0, 5, 10, 13)).harsh_accel_count).toBe(1);
    expect(smoothnessMetrics(speeds(0, 2, 4, 6)).harsh_accel_count).toBe(0); // 2.8 m/s² is normal
  });
  it("jerk_rms is 0 for constant acceleration and > 0 otherwise", () => {
    expect(smoothnessMetrics(speeds(10, 12, 14, 16, 18)).jerk_rms).toBe(0);
    expect(smoothnessMetrics(speeds(10, 12, 12, 16, 16)).jerk_rms).toBeGreaterThan(0);
  });
});

describe("control metrics", () => {
  it("steer_reversals_per_min counts sign changes with a swing > 0.3", () => {
    // 12 s moving (60 samples): +0.4→−0.4→+0.4→−0.4→+0.1 are 4 reversals; +0.1→−0.1 (swing 0.2) is not
    const steer = [...Array(15).fill(0.4), ...Array(15).fill(-0.4), ...Array(15).fill(0.4), ...Array(5).fill(-0.4), 0.1, -0.1, ...Array(8).fill(-0.1)];
    const s = mk(steer.map((v) => ({ steer: v, speed_kmh: 30 })));
    const c = controlMetrics(s, 12);
    expect(c.steer_reversals_per_min).toBe(20); // 4 reversals in 0.2 min
  });
  it("handbrake_uses counts rising edges", () => {
    const s = mk([0, 1, 1, 0, 1, 0].map((h) => ({ handbrake: h })));
    expect(controlMetrics(s, 1).handbrake_uses).toBe(2);
  });
});

describe("composure", () => {
  it("hesitation_stops: unexplained mid-drive stops ≥ 1.5 s", () => {
    // move, stop 2 s at x=100, move, stop 2 s at x=300 next to a STOP check, move, stop at the end
    const rows: Partial<Sample>[] = [];
    const seg = (n: number, speed: number, x: number) => {
      for (let i = 0; i < n; i++) rows.push({ speed_kmh: speed, x });
    };
    seg(10, 30, 50);
    seg(11, 0, 100);
    seg(10, 30, 200);
    seg(11, 0, 300);
    seg(10, 30, 400);
    seg(20, 0, 500);
    const s = mk(rows);
    const stopCheck = check({ id: "e1", t: 99, x: 305, z: 0 });
    expect(hesitationStops(s, [stopCheck])).toBe(1);
    expect(hesitationStops(s, [])).toBe(2);
  });
  it("composure_index: 100 when calm, lower with harsh events, reversals, hesitations, uneven speed", () => {
    expect(composureIndex({ harshPerMin: 0, reversalsPerMin: 0, hesitationStops: 0, speedCv: 0.3 })).toBe(100);
    expect(composureIndex({ harshPerMin: 1, reversalsPerMin: 0, hesitationStops: 0, speedCv: 0.3 })).toBe(88);
    expect(composureIndex({ harshPerMin: 0, reversalsPerMin: 4, hesitationStops: 2, speedCv: 0.55 })).toBe(74);
    expect(composureIndex({ harshPerMin: 10, reversalsPerMin: 50, hesitationStops: 10, speedCv: 2 })).toBe(0);
  });
});

describe("fixtures", () => {
  const load = (n: string) => ({
    m: computeMetrics(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8"))),
    exp: JSON.parse(readFileSync(`fixtures/${n}.expected.json`, "utf8")),
  });
  for (const n of ["clean_drive", "speeder", "red_light_runner", "nervous", "mixed_exam_fail", "progress_series_1", "progress_series_2", "progress_series_3"]) {
    it(`${n}: violations, severities and composure match expectations`, () => {
      const { m, exp } = load(n);
      const counts = Object.fromEntries(Object.entries(m.violations_by_rule).map(([k, v]) => [k, v!.count]));
      expect(counts).toEqual(exp.violations);
      expect(m.major_count).toBe(exp.major_count);
      expect(m.minor_count).toBe(exp.minor_count);
      if (exp.composure_min !== undefined) expect(m.composure_index).toBeGreaterThanOrEqual(exp.composure_min);
      if (exp.composure_max !== undefined) expect(m.composure_index).toBeLessThanOrEqual(exp.composure_max);
      if (exp.exam_passed !== undefined) expect(m.exam?.passed ?? null).toBe(exp.exam_passed);
    });
  }
  it("nervous has hesitation stops and reversals; clean_drive has none", () => {
    expect(load("nervous").m.hesitation_stops).toBeGreaterThan(0);
    expect(load("nervous").m.steer_reversals_per_min).toBeGreaterThan(10);
    expect(load("clean_drive").m.hesitation_stops).toBe(0);
  });
  it("speeder spends the most time over the limit", () => {
    expect(load("speeder").m.overspeed_time_share).toBeGreaterThan(load("red_light_runner").m.overspeed_time_share);
    expect(load("clean_drive").m.overspeed_time_share).toBe(0);
  });
});
