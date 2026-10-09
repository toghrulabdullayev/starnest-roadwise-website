import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFocus,
  focusFromTelemetry,
  type DriveFaults,
} from "../lib/profile/focus";
import { parseDriveTelemetry } from "../lib/telemetry/schema";

function fixture(id: string) {
  const parsed = parseDriveTelemetry(
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
    const focus = focusFromTelemetry([s1]);
    expect(focus[0].rule).toBe("speeding");
    expect(weightOf(focus, "red_light")).toBe(3);
    expect(weightOf(focus, "stop_sign")).toBe(1);
    expect(weightOf(focus, "pedestrian_crossing")).toBe(1);
    const weights = focus.map((f) => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("makes the weight fall for faults that stop appearing", () => {
    const afterOne = weightOf(focusFromTelemetry([s1]), "red_light");
    const afterTwo = weightOf(focusFromTelemetry([s1, s2]), "red_light");
    const afterThree = weightOf(focusFromTelemetry([s1, s2, s3]), "red_light");
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
    expect(focus.find((f) => f.rule === "stop_sign")?.trend).toBe("improved");
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
    const stop = focus.find((f) => f.rule === "stop_sign")!;
    expect(stop.count).toBe(2);
    expect(stop.last_seen).toBe(s2.drive.started_at);
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
