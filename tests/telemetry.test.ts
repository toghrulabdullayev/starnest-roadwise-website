import { describe, expect, it } from "vitest";
import { parseTelemetry, toSamples } from "@/lib/telemetry/schema";

/** The example from roadwise-platform §8 ("uuid-v4" placeholder replaced by a real UUID). */
function example() {
  return {
    schema: "roadwise.drive.v1",
    client: { name: "roadwise-unity", version: "0.1.0" },
    drive: {
      client_drive_id: "3f1c2a9e-8b7d-4c1e-9a2f-5d6e7f8a9b0c",
      mode: "free",
      district: "baku-center",
      route_id: null,
      car_type: "sedan",
      time_of_day: "day",
      started_at: "2026-10-09T15:00:00Z",
      duration_s: 412.6,
      distance_m: 3120.4,
      exam: null,
    },
    samples: {
      hz: 5,
      fields: ["t", "x", "z", "speed_kmh", "limit_kmh", "throttle", "brake", "steer", "handbrake"],
      rows: [[0.0, 12.3, -40.1, 0.0, 60, 0.0, 0.0, 0.0, 0]],
    },
    events: [
      { id: "e1", t: 34.2, type: "rule_check", rule: "stop_sign", outcome: "pass", x: 80.1, z: -12.0, street: "Nizami küç." },
      {
        id: "e2", t: 51.0, type: "rule_check", rule: "speeding", outcome: "fail", severity: "minor", fine_azn: 50,
        x: 140.0, z: -15.2, street: "Bakıxanov küç.", detail: { speed_kmh: 84, limit_kmh: 60 },
      },
      {
        id: "e3", t: 77.4, type: "rule_check", rule: "collision", outcome: "fail", severity: "major", fine_azn: 100,
        x: 210.0, z: -30.0, detail: { with: "building" },
      },
      { id: "e4", t: 90.0, type: "checkpoint", index: 3 },
    ],
  } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function issuesOf(input: unknown) {
  const r = parseTelemetry(input);
  return r.ok ? [] : r.issues;
}

describe("roadwise.drive.v1 schema", () => {
  it("accepts the contract example", () => {
    const r = parseTelemetry(example());
    expect(r.ok).toBe(true);
  });

  it("rejects unknown rule keys", () => {
    const d = example();
    d.events[1].rule = "tailgating";
    expect(issuesOf(d).some((i) => i.path === "events.1.rule")).toBe(true);
  });

  it("rejects bad fields: unknown, missing, duplicated, wrong row width", () => {
    const unknown = example();
    unknown.samples.fields[8] = "gear";
    expect(issuesOf(unknown).length).toBeGreaterThan(0);

    const missing = example();
    missing.samples.fields = missing.samples.fields.slice(0, 8);
    missing.samples.rows = [[0, 0, 0, 0, 60, 0, 0, 0]];
    expect(issuesOf(missing).length).toBeGreaterThan(0);

    const dup = example();
    dup.samples.fields[8] = "t";
    expect(issuesOf(dup).some((i) => i.message.includes('duplicate field "t"'))).toBe(true);

    const width = example();
    width.samples.rows.push([1, 2, 3]);
    expect(issuesOf(width).some((i) => i.path === "samples.rows.1")).toBe(true);
  });

  it("rejects duplicate event ids", () => {
    const d = example();
    d.events[2].id = "e1";
    expect(issuesOf(d).some((i) => i.message.includes('duplicate event id "e1"'))).toBe(true);
  });

  it("requires severity and fine on failed checks", () => {
    const d = example();
    delete d.events[1].severity;
    expect(issuesOf(d).some((i) => i.path === "events.1.severity")).toBe(true);
  });

  it("requires exam block only in exam mode", () => {
    const d = example();
    d.drive.mode = "exam";
    expect(issuesOf(d).some((i) => i.path === "drive.exam")).toBe(true);
  });

  it("maps rows to samples regardless of field order", () => {
    const d = example();
    d.samples.fields = ["x", "t", "z", "speed_kmh", "limit_kmh", "throttle", "brake", "steer", "handbrake"];
    d.samples.rows = [[12.3, 5, -40.1, 30, 60, 0.5, 0, 0.1, 0]];
    const r = parseTelemetry(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(toSamples(r.data)[0]).toMatchObject({ t: 5, x: 12.3, speed_kmh: 30 });
  });
});
