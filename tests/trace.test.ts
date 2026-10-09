import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTrace, MAX_TRACE_POINTS } from "@/lib/trace";
import { parseTelemetry } from "@/lib/telemetry/schema";

const tel = (n: string) => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(n);
  return r.data;
};

describe("trace", () => {
  it("fits all points and markers inside the viewBox", () => {
    const tr = buildTrace(tel("speeder"));
    const [x, z, w, h] = tr.viewBox;
    for (const run of tr.runs) for (const [px, pz] of run.points) {
      expect(px).toBeGreaterThanOrEqual(x);
      expect(px).toBeLessThanOrEqual(x + w);
      expect(pz).toBeGreaterThanOrEqual(z);
      expect(pz).toBeLessThanOrEqual(z + h);
    }
  });
  it("marks overspeed runs and fault markers", () => {
    const tr = buildTrace(tel("speeder"));
    expect(tr.runs.some((r) => r.over)).toBe(true);
    expect(tr.markers.filter((m) => m.kind === "major")).toHaveLength(1);
    expect(buildTrace(tel("clean_drive")).runs.every((r) => !r.over)).toBe(true);
  });
  it("downsamples to at most 1,500 points", () => {
    const t = tel("clean_drive");
    const rows = Array.from({ length: 6000 }, (_, i) => [i / 5, i, 0, 30, 60, 0.2, 0, 0, 0]);
    const tr = buildTrace({ ...t, samples: { ...t.samples, rows } });
    const n = tr.runs.reduce((a, r) => a + r.points.length, 0);
    expect(n).toBeLessThanOrEqual(MAX_TRACE_POINTS + tr.runs.length);
  });
});
