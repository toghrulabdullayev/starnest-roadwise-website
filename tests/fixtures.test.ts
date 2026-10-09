import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseTelemetry } from "@/lib/telemetry/schema";

const dir = path.join(process.cwd(), "fixtures");
const names = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"));

describe("fixtures", () => {
  it("has the eight scenarios", () => {
    expect(names.map((n) => n.replace(".json", "")).sort()).toEqual(
      ["clean_drive", "mixed_exam_fail", "nervous", "progress_series_1", "progress_series_2", "progress_series_3", "red_light_runner", "speeder"],
    );
  });
  for (const n of names) {
    it(`${n} validates and matches its expected faults`, () => {
      const r = parseTelemetry(JSON.parse(readFileSync(path.join(dir, n), "utf8")));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const exp = JSON.parse(readFileSync(path.join(dir, n.replace(".json", ".expected.json")), "utf8"));
      const failed = r.data.events.filter((e) => e.type === "rule_check" && e.outcome === "fail");
      expect(failed.length).toBe(exp.major_count + exp.minor_count);
    });
  }
  it("invalid uploads are rejected", () => {
    for (const n of ["unknown_rule.json", "bad_fields.json"]) {
      const r = parseTelemetry(JSON.parse(readFileSync(path.join(dir, "invalid", n), "utf8")));
      expect(r.ok).toBe(false);
    }
  });
});
