import { describe, expect, it } from "vitest";
import { internalKeys, localizeDecimals, styleRules } from "@/lib/ai/style";

describe("AI text style", () => {
  it("finds snake_case keys in every locale", () => {
    expect(internalKeys("You were in the not_ready band.", "en")).toEqual(["not_ready"]);
    expect(internalKeys("Nizami küçəsində 'stop_sign' tələbi", "az")).toEqual(["stop_sign"]);
  });
  it("finds key words only as whole Latin words in Russian and Azerbaijani", () => {
    expect(internalKeys("компоненты minors и compliance", "ru").sort()).toEqual(["compliance", "minors"]);
    expect(internalKeys("Harsh braking and compliance; almost ready.", "en")).toEqual([]);
    expect(internalKeys("Füzuli küçəsində sürətinizi azaldın", "az")).toEqual([]);
  });
  it("uses a decimal comma in Russian and Azerbaijani, leaves dates and English alone", () => {
    expect(localizeDecimals("minors (-13.4) и 1.8 км", "ru")).toBe("minors (-13,4) и 1,8 км");
    expect(localizeDecimals("07.10.2026, 9.7 bal", "az")).toBe("07.10.2026, 9,7 bal");
    expect(localizeDecimals("-9.7 points", "en")).toBe("-9.7 points");
  });
  it("asks for the site's terms in each language", () => {
    expect(styleRules("az").join(" ")).toContain("km/saat");
    expect(styleRules("ru").join(" ")).toContain("км/ч");
    expect(styleRules("en").join(" ")).not.toContain("decimal comma");
  });
});

import { safeNext } from "@/lib/auth/currentUser";
describe("safeNext keeps the chosen language", () => {
  it("rewrites the locale segment, keeps the rest, still rejects unsafe paths", () => {
    expect(safeNext("/az/profile", "", "en")).toBe("/en/profile");
    expect(safeNext("/az/drives/x?a=1", "", "ru")).toBe("/ru/drives/x?a=1");
    expect(safeNext("/api/me", "", "en")).toBe("/api/me");
    expect(safeNext("/az/profile", "")).toBe("/az/profile");
    expect(safeNext("//evil.com", "/x", "en")).toBe("/x");
  });
});
