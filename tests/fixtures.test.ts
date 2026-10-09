import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDriveTelemetry } from "../lib/telemetry/schema";

const dir = join(__dirname, "..", "fixtures");
const ids = [
  "clean_drive",
  "speeder",
  "red_light_runner",
  "nervous",
  "mixed_exam_fail",
  "progress_series_1",
  "progress_series_2",
  "progress_series_3",
];

const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("fixtures", () => {
  it("contains exactly the planned fixtures and expectations", () => {
    const files = readdirSync(dir).sort();
    expect(files).toEqual(
      ids.flatMap((id) => [`${id}.expected.json`, `${id}.json`]).sort(),
    );
  });

  it.each(ids)("%s validates against the telemetry schema", (id) => {
    const result = parseDriveTelemetry(load(`${id}.json`));
    expect(result.ok).toBe(true);
  });

  it.each(ids)("%s matches its expectations", (id) => {
    const t = parseDriveTelemetry(load(`${id}.json`));
    if (!t.ok) throw new Error("invalid fixture");
    const expected = load(`${id}.expected.json`);
    const checks = t.data.events.filter((e) => e.type === "rule_check");
    const fails = checks.filter((e) => e.outcome === "fail");
    expect(expected.checks_total).toBe(checks.length);
    expect(expected.checks_passed).toBe(checks.length - fails.length);
    expect(expected.major_count).toBe(
      fails.filter((e) => e.severity === "major").length,
    );
    expect(expected.minor_count).toBe(
      fails.filter((e) => e.severity === "minor").length,
    );
    expect(expected.fines_total_azn).toBe(
      fails.reduce((n, e) => n + (e.fine_azn ?? 0), 0),
    );
    expect(Object.keys(expected.violations_by_rule).sort()).toEqual(
      [...new Set(fails.map((e) => e.rule))].sort(),
    );
  });

  it("gives the clean and nervous drives no violations", () => {
    for (const id of ["clean_drive", "nervous"]) {
      expect(load(`${id}.expected.json`).fines_total_azn).toBe(0);
      expect(load(`${id}.expected.json`).top_issue_rule).toBeNull();
    }
  });

  it("gives the exam fixture a failed exam that ended on the major fault", () => {
    const t = load("mixed_exam_fail.json");
    expect(t.drive.mode).toBe("exam");
    expect(t.drive.exam.passed).toBe(false);
    const last = t.events[t.events.length - 1];
    expect(last.rule).toBe("give_way");
    expect(last.severity).toBe("major");
  });

  it("makes the progress series improve in fines and links the chain", () => {
    const fines = [1, 2, 3].map(
      (n) => load(`progress_series_${n}.expected.json`).fines_total_azn,
    );
    expect(fines[0]).toBeGreaterThan(fines[1]);
    expect(fines[1]).toBeGreaterThan(fines[2]);
    expect(load("progress_series_2.expected.json").previous).toBe("progress_series_1");
    expect(load("progress_series_3.expected.json").previous).toBe("progress_series_2");
    const dates = [1, 2, 3].map(
      (n) => load(`progress_series_${n}.json`).drive.started_at,
    );
    expect([...dates].sort()).toEqual(dates);
  });

  it("has unique drive ids across fixtures", () => {
    const driveIds = ids.map((id) => load(`${id}.json`).drive.client_drive_id);
    expect(new Set(driveIds).size).toBe(ids.length);
  });
});
