import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  isProtectedPath,
  loginRedirectUrl,
  safeNext,
} from "../lib/auth/redirects";
import { proxy } from "../proxy";

describe("safeNext", () => {
  it("keeps same-locale local paths", () => {
    expect(safeNext("/en/drives/abc?x=1", "en")).toBe("/en/drives/abc?x=1");
    expect(safeNext("/ru/profile", "ru")).toBe("/ru/profile");
  });

  it("falls back to the profile for anything unsafe", () => {
    const fallback = "/en/profile";
    for (const bad of [
      undefined,
      "",
      "https://evil.example/en/x",
      "//evil.example",
      "/en//evil.example",
      "/\\evil.example",
      "/ru/profile",
      "/en/login",
      "/en/signup?next=/en/profile",
      "/en/a\nb",
      "/en/" + "a".repeat(400),
    ]) {
      expect(safeNext(bad, "en")).toBe(fallback);
    }
  });
});

describe("protected paths", () => {
  it("flags profile, drives and link", () => {
    expect(isProtectedPath(["en", "profile"])).toBe(true);
    expect(isProtectedPath(["az", "drives", "abc"])).toBe(true);
    expect(isProtectedPath(["ru", "link"])).toBe(true);
    expect(isProtectedPath(["en"])).toBe(false);
    expect(isProtectedPath(["en", "login"])).toBe(false);
  });

  it("builds a login URL that carries the original page", () => {
    expect(loginRedirectUrl("en", "/en/drives/a", "?x=1")).toBe(
      "/en/login?next=%2Fen%2Fdrives%2Fa%3Fx%3D1",
    );
  });
});

describe("proxy auth gate", () => {
  const request = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie } : {},
    });

  it("sends anonymous visitors to log in and remembers the page", () => {
    const res = proxy(request("/en/drives/abc?tab=map"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/en/login?next=%2Fen%2Fdrives%2Fabc%3Ftab%3Dmap",
    );
  });

  it("lets visitors with a session cookie through and refreshes it", () => {
    const res = proxy(request("/en/profile", "rw_session=abc"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("rw_session")?.value).toBe("abc");
    expect(res.cookies.get("rw_session")?.httpOnly).toBe(true);
  });

  it("leaves public pages alone", () => {
    const res = proxy(request("/en/login"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("rw_session")).toBeUndefined();
  });
});
