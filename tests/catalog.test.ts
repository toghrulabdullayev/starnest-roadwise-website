import { describe, expect, it } from "vitest";
import { locales } from "../lib/i18n/config";
import {
  expectedOutcome,
  isRuleKey,
  ruleKeys,
  ruleName,
  rules,
  speedingBand,
} from "../lib/rules/catalog";

describe("rule catalog", () => {
  it("has exactly the canonical keys", () => {
    expect([...ruleKeys].sort()).toEqual(
      [
        "collision",
        "give_way",
        "pedestrian_crossing",
        "red_light",
        "speeding",
        "stop_sign",
        "wrong_way",
      ].sort(),
    );
  });

  it("names every rule in every locale", () => {
    for (const key of ruleKeys) {
      expect(rules[key].key).toBe(key);
      for (const locale of locales) {
        expect(ruleName(key, locale).length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects unknown keys", () => {
    expect(isRuleKey("red_light")).toBe(true);
    expect(isRuleKey("jaywalking")).toBe(false);
    expect(isRuleKey(undefined)).toBe(false);
  });

  it("marks only give_way and collision as provisional", () => {
    const provisional = ruleKeys.filter((k) => rules[k].provisional);
    expect(provisional.sort()).toEqual(["collision", "give_way"]);
  });

  it("returns fixed severity and fine for non-speeding rules", () => {
    expect(expectedOutcome("red_light")).toEqual({ severity: "major", fineAzn: 100 });
    expect(expectedOutcome("stop_sign")).toEqual({ severity: "minor", fineAzn: 40 });
    expect(expectedOutcome("pedestrian_crossing")).toEqual({ severity: "minor", fineAzn: 50 });
    expect(expectedOutcome("wrong_way")).toEqual({ severity: "major", fineAzn: 150 });
  });
});

describe("speeding bands", () => {
  it("ignores speeds below the first band", () => {
    expect(speedingBand(0)).toBeNull();
    expect(speedingBand(10)).toBeNull();
    expect(speedingBand(Number.NaN)).toBeNull();
  });

  it.each([
    [11, "minor", 10],
    [20, "minor", 10],
    [21, "minor", 50],
    [40, "minor", 50],
    [41, "major", 200],
    [60, "major", 200],
    [61, "major", 300],
    [150, "major", 300],
  ])("over %i km/h -> %s, %i AZN", (over, severity, fine) => {
    expect(speedingBand(over)).toMatchObject({ severity, fineAzn: fine });
    expect(expectedOutcome("speeding", over)).toEqual({ severity, fineAzn: fine });
  });

  it("needs the overshoot to price speeding", () => {
    expect(expectedOutcome("speeding")).toBeNull();
  });
});
