import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFocus,
  faultsFromTelemetry,
  focusFromTelemetry,
  type DriveFaults,
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

const weightOf = (focus: ReturnType<typeof computeFocus>, rule: string) =>
  focus.find((f) => f.rule === rule)?.weight ?? 0;

describe("weakness profile", () => {
  it("is empty without drives or without faults", () => {
    expect(computeFocus([])).toEqual([]);
    expect(focusFromTelemetry([fixture("clean_drive")])).toEqual([]);
    expect(focusFromTelemetry([fixture("nervous")])).toEqual([]);
  });

  it("weights major faults above minor ones and sorts by weight", () => {
    // mixed_exam_fail: wrong_way (major) + stop_sign and pedestrian_crossing (minor)
    const focus = focusFromTelemetry([fixture("mixed_exam_fail")]);
    expect(focus[0].rule).toBe("wrong_way");
    expect(weightOf(focus, "wrong_way")).toBe(3);
    expect(weightOf(focus, "stop_sign")).toBe(1);
    expect(weightOf(focus, "pedestrian_crossing")).toBe(1);
    const weights = focus.map((f) => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("makes the weight fall for faults that stop appearing", () => {
    // the rolled STOP appears only in progress_series_1
    const afterOne = weightOf(focusFromTelemetry([s1]), "stop_sign");
    const afterTwo = weightOf(focusFromTelemetry([s1, s2]), "stop_sign");
    const afterThree = weightOf(focusFromTelemetry([s1, s2, s3]), "stop_sign");
    expect(afterOne).toBeGreaterThan(afterTwo);
    expect(afterTwo).toBeGreaterThan(afterThree);
    expect(afterThree).toBeGreaterThan(0);
  });

  it("drops faults that never appeared in the window to zero entries", () => {
    const focus = focusFromTelemetry([s1, s2, s3]);
    expect(focus.map((f) => f.rule)).not.toContain("collision");
  });

  it("reports trends", () => {
    const focus = focusFromTelemetry([s1, s2, s3]);
    // speeding faults per drive: 2 → 1 → 0
    expect(focus.find((f) => f.rule === "speeding")?.trend).toBe("improved");
    const worse = computeFocus([
      { drive_id: "a", started_at: "2026-10-01T00:00:00Z", faults: [] },
      { drive_id: "b", started_at: "2026-10-02T00:00:00Z", faults: [{ rule: "give_way", severity: "major" }] },
    ]);
    expect(worse[0].trend).toBe("worse");
  });

  it("orders drives by date regardless of input order", () => {
    const a = focusFromTelemetry([s1, s2, s3]);
    const b = focusFromTelemetry([s3, s1, s2]);
    expect(b).toEqual(a);
  });

  it("records how often and when a fault was last seen", () => {
    const focus = focusFromTelemetry([s1, s2]);
    const speeding = focus.find((f) => f.rule === "speeding")!;
    expect(speeding.count).toBe(3);
    expect(speeding.last_seen).toBe(s2.drive.started_at);
  });

  it("handles repeated faults inside one drive", () => {
    const drive: DriveFaults = {
      drive_id: "x",
      started_at: "2026-10-01T00:00:00Z",
      faults: [
        { rule: "speeding", severity: "minor" },
        { rule: "speeding", severity: "minor" },
      ],
    };
    expect(computeFocus([drive])[0]).toMatchObject({ rule: "speeding", weight: 2, count: 2, trend: "same" });
  });
});

describe("weight is a recency-weighted average per drive", () => {
  const drive = (n: number, faults: DriveFaults["faults"]): DriveFaults => ({
    drive_id: `d${n}`,
    started_at: new Date(Date.UTC(2026, 9, 1 + n)).toISOString(),
    faults,
  });
  const minor = (n: number) => Array.from({ length: n }, () => ({ rule: "speeding" as const, severity: "minor" as const }));
  const weightAfter = (counts: number[]) =>
    computeFocus(counts.map((c, i) => drive(i, minor(c))))[0]?.weight ?? 0;

  it("keeps a steady fault rate at the same weight however many drives it spans", () => {
    expect(weightAfter([2])).toBe(2);
    expect(weightAfter([2, 2, 2])).toBe(2);
    expect(weightAfter([2, 2, 2, 2, 2, 2, 2, 2])).toBe(2);
  });

  it("never rises while the fault count per drive does not rise", () => {
    expect(weightAfter([2, 1])).toBeLessThan(weightAfter([2]));
    expect(weightAfter([2, 1, 0])).toBeLessThan(weightAfter([2, 1]));
    const seen: number[] = [];
    let state = 12345;
    const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 300; trial++) {
      const counts: number[] = [];
      let current = Math.floor(rand() * 8) + 1;
      for (let i = 0; i < 6; i++) {
        counts.push(current);
        if (rand() < 0.6) current = Math.max(0, current - Math.floor(rand() * 3));
      }
      let previous = Infinity;
      for (let k = 1; k <= counts.length; k++) {
        const w = weightAfter(counts.slice(0, k));
        expect(w, `counts ${counts.slice(0, k).join(",")}`).toBeLessThanOrEqual(previous + 1e-9);
        previous = w;
        seen.push(w);
      }
    }
    expect(seen.length).toBe(1800);
  });

  it("rises when the fault count rises", () => {
    expect(weightAfter([1, 3])).toBeGreaterThan(weightAfter([1]));
  });

  it("falls steadily on the improving fixture series for a rule with repeated faults", () => {
    const counts = [s1, s2, s3].map((t) => faultsFromTelemetry(t).faults.filter((f) => f.rule === "speeding").length);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    const w = [1, 2, 3].map((k) => weightOf(focusFromTelemetry([s1, s2, s3].slice(0, k)), "speeding"));
    expect(w[1]).toBeLessThan(w[0]);
    expect(w[2]).toBeLessThan(w[1]);
  });
});
