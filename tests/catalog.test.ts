import { describe, expect, it } from "vitest";
import { RULES, RULE_KEYS, isRuleKey, ruleOutcome, speedingBand } from "@/lib/rules/catalog";

describe("rule catalog", () => {
  it("has the seven canonical keys with names in all locales", () => {
    expect(RULE_KEYS).toEqual(["speeding", "red_light", "stop_sign", "pedestrian_crossing", "wrong_way", "give_way", "collision"]);
    for (const k of RULE_KEYS) for (const l of ["en", "ru", "az"] as const) expect(RULES[k].names[l]).toBeTruthy();
  });
  it("rejects unknown keys", () => {
    expect(isRuleKey("red_light")).toBe(true);
    expect(isRuleKey("tailgating")).toBe(false);
  });
  it("maps speeding bands", () => {
    expect(speedingBand(10)).toBeNull();
    expect(speedingBand(15)).toMatchObject({ fineAzn: 10, severity: "minor" });
    expect(speedingBand(24)).toMatchObject({ fineAzn: 50, severity: "minor" });
    expect(speedingBand(45)).toMatchObject({ fineAzn: 200, severity: "major" });
    expect(speedingBand(80)).toMatchObject({ fineAzn: 300, severity: "major" });
    expect(ruleOutcome("red_light")).toEqual({ severity: "major", fineAzn: 100 });
  });
});
