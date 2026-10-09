import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { locales, matchAcceptLanguage } from "../lib/i18n/config";
import { getDictionary } from "../lib/i18n/getDictionary";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value)
    .filter(([k]) => k !== "_review")
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("matchAcceptLanguage", () => {
  it("picks the highest-ranked supported language", () => {
    expect(matchAcceptLanguage("de;q=0.9, ru;q=0.8, az;q=0.7")).toBe("ru");
    expect(matchAcceptLanguage("az-AZ,az;q=0.9,en;q=0.5")).toBe("az");
  });
  it("returns null when nothing matches", () => {
    expect(matchAcceptLanguage("de,fr;q=0.8")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});

describe("proxy", () => {
  it("redirects / to /en by default", () => {
    const res = proxy(request("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/en");
  });
  it("uses Accept-Language", () => {
    const res = proxy(request("/", { "accept-language": "ru-RU,ru;q=0.9" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/ru");
  });
  it("prefers the NEXT_LOCALE cookie", () => {
    const res = proxy(
      request("/profile", {
        cookie: "NEXT_LOCALE=az",
        "accept-language": "ru",
      }),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/az/profile");
  });
  it("ignores an invalid cookie", () => {
    const res = proxy(request("/", { cookie: "NEXT_LOCALE=xx" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/en");
  });
  it("passes through locale paths and remembers the locale", () => {
    const res = proxy(request("/ru/download"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("NEXT_LOCALE")?.value).toBe("ru");
  });
});

describe("dictionaries", () => {
  it("have identical keys in every locale", async () => {
    const en = keys(await getDictionary("en")).sort();
    for (const locale of locales) {
      expect(keys(await getDictionary(locale)).sort()).toEqual(en);
    }
  });
  it("flag ru and az for native review", async () => {
    expect(await getDictionary("ru")).toHaveProperty("_review", true);
    expect(await getDictionary("az")).toHaveProperty("_review", true);
  });
});
