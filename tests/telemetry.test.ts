import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  driveTelemetrySchema,
  parseDriveTelemetry,
} from "../lib/telemetry/schema";

function example() {
  return JSON.parse(
    readFileSync(join(__dirname, "data", "example.v1.json"), "utf8"),
  );
}

function paths(input: unknown): string[] {
  const result = parseDriveTelemetry(input);
  return result.ok ? [] : result.issues.map((i) => i.path);
}

describe("roadwise.drive.v1 schema", () => {
  it("accepts the contract example", () => {
    const result = parseDriveTelemetry(example());
    expect(result.ok).toBe(true);
  });

  it("accepts an exam drive with a result", () => {
    const t = example();
    t.drive.mode = "exam";
    t.drive.route_id = "r1";
    t.drive.exam = {
      passed: false,
      minor_faults: 1,
      major_faults: 1,
      checkpoints_reached: 3,
      checkpoints_total: 8,
    };
    expect(parseDriveTelemetry(t).ok).toBe(true);
  });

  it("rejects an unknown rule key", () => {
    const t = example();
    t.events[0].rule = "jaywalking";
    expect(paths(t)).toContain("events.0.rule");
  });

  it("rejects bad sample fields", () => {
    const t = example();
    t.samples.fields = ["t", "x", "z"];
    expect(paths(t)).toContain("samples.fields");
    const reordered = example();
    reordered.samples.fields.reverse();
    expect(paths(reordered)).toContain("samples.fields");
  });

  it("rejects rows of the wrong length", () => {
    const t = example();
    t.samples.rows.push([1, 2, 3]);
    expect(paths(t)).toContain("samples.rows.1");
  });

  it("rejects duplicate event ids", () => {
    const t = example();
    t.events[1].id = "e1";
    expect(paths(t)).toContain("events.1.id");
  });

  it("requires severity and fine on a failed check", () => {
    const t = example();
    delete t.events[1].severity;
    delete t.events[1].fine_azn;
    const p = paths(t);
    expect(p).toContain("events.1.severity");
    expect(p).toContain("events.1.fine_azn");
  });

  it("ties the exam result to the mode", () => {
    const exam = example();
    exam.drive.mode = "exam";
    expect(paths(exam)).toContain("drive.exam");
    const free = example();
    free.drive.exam = {
      passed: true,
      minor_faults: 0,
      major_faults: 0,
      checkpoints_reached: 1,
      checkpoints_total: 1,
    };
    expect(paths(free)).toContain("drive.exam");
  });

  it("rejects a wrong schema id and non-finite numbers", () => {
    const t = example();
    t.schema = "roadwise.drive.v2";
    expect(paths(t)).toContain("schema");
    const bad = example();
    bad.drive.duration_s = -1;
    expect(paths(bad)).toContain("drive.duration_s");
  });

  it("rejects a non-object body", () => {
    expect(parseDriveTelemetry(null).ok).toBe(false);
    expect(parseDriveTelemetry("x").ok).toBe(false);
  });
});

describe("contracts/roadwise.drive.v1.schema.json", () => {
  it("is in sync with the zod schema", () => {
    const committed = JSON.parse(
      readFileSync(
        join(__dirname, "..", "contracts", "roadwise.drive.v1.schema.json"),
        "utf8",
      ),
    );
    const generated = JSON.parse(
      JSON.stringify(z.toJSONSchema(driveTelemetrySchema, { io: "input" })),
    );
    expect(committed).toEqual(generated);
  });
});
