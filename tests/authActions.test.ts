import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./helpers/testDb";

const state = vi.hoisted(() => ({
  db: null as unknown as Client,
  jar: new Map<string, string>(),
  ip: "1.1.1.1",
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock("../lib/db", () => ({ getDb: () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () =>
    new Headers({ "x-forwarded-for": state.ip, "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

import { logIn, logOut, signUp } from "../lib/auth/actions";
import { validateSession } from "../lib/auth/session";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof Redirect) return err.url;
    throw err;
  }
}

const signup = (extra: Record<string, string> = {}) =>
  form({
    locale: "en",
    email: "Driver@Example.com",
    display_name: "  Aysel  ",
    password: "correct horse",
    next: "/en/profile",
    ...extra,
  });

describe("auth actions", () => {
  beforeEach(async () => {
    state.db = await createTestDb();
    state.jar.clear();
    state.ip = `10.0.0.${Math.floor(Math.random() * 250)}`;
  });

  it("signs up, starts a session and goes to the profile", async () => {
    expect(await redirectOf(signUp({}, signup()))).toBe("/en/profile");
    const token = state.jar.get("rw_session");
    expect(token).toBeTruthy();
    const session = await validateSession(token, { db: state.db });
    expect(session?.user.email).toBe("driver@example.com");
    expect(session?.user.display_name).toBe("Aysel");
    expect(session?.user.locale).toBe("en");
  });

  it("stores the current locale on the new user", async () => {
    await redirectOf(signUp({}, signup({ locale: "az", next: "/az/profile" })));
    const row = (await state.db.execute("SELECT locale FROM users")).rows[0];
    expect(row.locale).toBe("az");
  });

  it("rejects duplicate emails, bad input and keeps the email", async () => {
    await redirectOf(signUp({}, signup()));
    state.jar.clear();
    expect(await signUp({}, signup())).toEqual({
      error: "email_taken",
      email: "driver@example.com",
    });
    expect((await signUp({}, signup({ email: "nope" }))).error).toBe("invalid_email");
    expect((await signUp({}, signup({ password: "short" }))).error).toBe("password_too_short");
    expect((await signUp({}, signup({ display_name: "  " }))).error).toBe("name_required");
    expect(state.jar.has("rw_session")).toBe(false);
  });

  it("logs in and returns to the requested page", async () => {
    await redirectOf(signUp({}, signup()));
    state.jar.clear();
    const url = await redirectOf(
      logIn({}, form({ locale: "en", email: "driver@example.com", password: "correct horse", next: "/en/drives/abc" })),
    );
    expect(url).toBe("/en/drives/abc");
    expect(state.jar.get("rw_session")).toBeTruthy();
  });

  it("gives the same generic error for a wrong password and an unknown email", async () => {
    await redirectOf(signUp({}, signup()));
    state.jar.clear();
    const wrong = await logIn({}, form({ locale: "en", email: "driver@example.com", password: "wrong password" }));
    const unknown = await logIn({}, form({ locale: "en", email: "ghost@example.com", password: "wrong password" }));
    expect(wrong.error).toBe("invalid_credentials");
    expect(unknown.error).toBe("invalid_credentials");
    expect(state.jar.has("rw_session")).toBe(false);
  });

  it("ignores an unsafe next target", async () => {
    await redirectOf(signUp({}, signup()));
    state.jar.clear();
    const url = await redirectOf(
      logIn({}, form({ locale: "en", email: "driver@example.com", password: "correct horse", next: "https://evil.example" })),
    );
    expect(url).toBe("/en/profile");
  });

  it("blocks the sixth attempt in ten minutes", async () => {
    const attempt = () =>
      logIn({}, form({ locale: "en", email: "burst@example.com", password: "wrong password" }));
    for (let i = 0; i < 5; i++) expect((await attempt()).error).toBe("invalid_credentials");
    expect((await attempt()).error).toBe("too_many_attempts");
  });

  it("logs out: deletes the session and the cookie", async () => {
    await redirectOf(signUp({}, signup()));
    const token = state.jar.get("rw_session");
    expect(await redirectOf(logOut(form({ locale: "ru" })))).toBe("/ru");
    expect(state.jar.has("rw_session")).toBe(false);
    expect(await validateSession(token, { db: state.db })).toBeNull();
  });
});
