import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeMetrics, type DriveMetrics } from "@/lib/metrics";
import { bandFor, computeReadiness } from "@/lib/readiness";
import { computeHistory } from "@/lib/history";

const metrics = (n: string) => computeMetrics(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
const expected = (n: string) => JSON.parse(readFileSync(`fixtures/${n}.expected.json`, "utf8"));

function base(over: Partial<DriveMetrics> = {}): DriveMetrics {
  return {
    checks_total: 5, checks_passed: 5, compliance_rate: 1, violations_by_rule: {}, fines_total_azn: 0, major_count: 0, minor_count: 0,
    overspeed_time_share: 0, mean_overspeed_kmh: 0, avg_speed_kmh: 40, max_speed_kmh: 55, harsh_brake_count: 0, harsh_accel_count: 0,
    jerk_rms: 1, steer_reversals_per_min: 0, collisions: 0, handbrake_uses: 0, hesitation_stops: 0, speed_cv: 0.3, composure_index: 100,
    exam: null, duration_s: 600, distance_m: 5000, moving_time_s: 600, mode: "free", district: "baku-center", ...over,
  };
}

describe("readiness", () => {
  it("bands: <50 not_ready, 50–74 almost, ≥75 ready", () => {
    expect([bandFor(49), bandFor(50), bandFor(74), bandFor(75)]).toEqual(["not_ready", "almost", "almost", "ready"]);
  });
  it("a perfect drive scores 100 with every component at 0", () => {
    const r = computeReadiness([base()]);
    expect(r.score).toBe(100);
    expect(r.components.every((c) => c.points === 0)).toBe(true);
  });
  it("applies the formula per component", () => {
    const r = computeReadiness([base({ major_count: 1, minor_count: 1, compliance_rate: 0.5, overspeed_time_share: 0.1, harsh_brake_count: 2, composure_index: 80 })]);
    const p = Object.fromEntries(r.components.map((c) => [c.key, c.points]));
    expect(p).toMatchObject({ majors: -25, minors: -8, compliance: -15, overspeed: -2, harsh: -4, composure: -3, exam_bonus: 0 });
    expect(r.score).toBe(43);
  });
  it("weights the latest drives 0.35/0.25/0.2/0.12/0.08, renormalised", () => {
    const two = computeReadiness([base({ major_count: 1 }), base()]);
    expect(two.components.find((c) => c.key === "majors")!.value).toBe(0.58); // 0.35/0.6
    const six = computeReadiness([base(), base(), base(), base(), base(), base({ major_count: 9 })]);
    expect(six.drives_considered).toBe(5);
    expect(six.score).toBe(100);
  });
  it("adds 5 when the latest exam drive passed, and clamps to 0..100", () => {
    const exam = { passed: true, minor_faults: 1, major_faults: 0, checkpoints_reached: 3, checkpoints_total: 3 };
    expect(computeReadiness([base({ mode: "exam", exam, minor_count: 1 })]).score).toBe(97);
    expect(computeReadiness([base({ major_count: 10 })]).score).toBe(0);
  });
  for (const n of ["clean_drive", "speeder", "red_light_runner", "nervous", "mixed_exam_fail", "progress_series_1"]) {
    it(`${n} alone lands in band ${expected(n).readiness_band}`, () => {
      expect(computeReadiness([metrics(n)]).band).toBe(expected(n).readiness_band);
    });
  }
  it("progress series climbs not_ready → almost → ready", () => {
    const [s1, s2, s3] = [1, 2, 3].map((i) => metrics(`progress_series_${i}`));
    const bands = [computeReadiness([s1]), computeReadiness([s2, s1]), computeReadiness([s3, s2, s1])];
    expect(bands.map((b) => b.band)).toEqual([1, 2, 3].map((i) => expected(`progress_series_${i}`).readiness_band));
    expect(bands[0].score).toBeLessThan(bands[1].score);
    expect(bands[1].score).toBeLessThan(bands[2].score);
  });
});

describe("history", () => {
  it("first drive → null", () => {
    expect(computeHistory(base(), [])).toBeNull();
  });
  it("compares with the mean of up to 4 previous drives", () => {
    const h = computeHistory(base({ fines_total_azn: 0 }), [base({ fines_total_azn: 100 }), base({ fines_total_azn: 50 }), base(), base(), base({ fines_total_azn: 999 })])!;
    expect(h.previous_count).toBe(4);
    expect(h.deltas.find((d) => d.key === "fines_azn")).toMatchObject({ previous_mean: 37.5, direction: "improved" });
  });
  it("small changes are 'same'; direction respects higher/lower is better", () => {
    const h = computeHistory(base({ compliance_rate: 0.98, composure_index: 70 }), [base({ compliance_rate: 1, composure_index: 90 })])!;
    expect(h.deltas.find((d) => d.key === "compliance_rate")!.direction).toBe("same");
    expect(h.deltas.find((d) => d.key === "composure_index")!.direction).toBe("worse");
  });
  it("progress_series shows the expected improvements", () => {
    const [s1, s2, s3] = [1, 2, 3].map((i) => metrics(`progress_series_${i}`));
    const h2 = computeHistory(s2, [s1])!;
    const h3 = computeHistory(s3, [s2, s1])!;
    for (const [h, n] of [[h2, 2], [h3, 3]] as const) {
      for (const key of expected(`progress_series_${n}`).series.expect_improved) {
        expect(h.deltas.find((d) => d.key === key)?.direction, `${key} in series ${n}`).toBe("improved");
      }
    }
    expect(h3.rules.find((r) => r.rule === "speeding")).toMatchObject({ current: 0, direction: "improved" });
  });
});
