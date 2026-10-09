import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "../lib/auth/password";
import { createRateLimiter } from "../lib/auth/rateLimit";
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  hashToken,
  validateSession,
} from "../lib/auth/session";
import { createTestDb, insertUser } from "./helpers/testDb";

describe("password", () => {
  it("hashes in the documented format and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("uses a fresh salt each time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$a$b")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "scrypt$99999999$8$1$AAAA$AAAA")).toBe(false);
  });

  it("validates length and email", () => {
    expect(validatePassword("short")).toBe("too_short");
    expect(validatePassword("long enough")).toBeNull();
    expect(validatePassword("x".repeat(129))).toBe("too_long");
    expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com");
    expect(isValidEmail("me@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
  });
});

describe("sessions", () => {
  let db: Client;
  let userId: string;
  const day = 24 * 60 * 60 * 1000;
  const t0 = new Date("2026-10-09T12:00:00Z");

  beforeEach(async () => {
    db = await createTestDb();
    userId = await insertUser(db);
  });

  it("stores only the token hash", async () => {
    const { token } = await createSession(userId, { db, now: t0 });
    const rows = (await db.execute("SELECT token_hash FROM auth_sessions")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("validates a fresh session and returns the user", async () => {
    const { token } = await createSession(userId, { db, now: t0 });
    const session = await validateSession(token, { db, now: t0 });
    expect(session?.user.id).toBe(userId);
    expect(session?.renewed).toBe(false);
  });

  it("rejects unknown and empty tokens", async () => {
    expect(await validateSession("nope", { db, now: t0 })).toBeNull();
    expect(await validateSession("", { db, now: t0 })).toBeNull();
    expect(await validateSession(undefined, { db, now: t0 })).toBeNull();
  });

  it("expires after 30 days and removes the row", async () => {
    const { token } = await createSession(userId, { db, now: t0 });
    const later = new Date(t0.getTime() + 30 * day + 1000);
    expect(await validateSession(token, { db, now: later })).toBeNull();
    const rows = (await db.execute("SELECT 1 FROM auth_sessions")).rows;
    expect(rows).toHaveLength(0);
  });

  it("renews once fewer than 15 days remain", async () => {
    const { token } = await createSession(userId, { db, now: t0 });
    const at14 = new Date(t0.getTime() + 14 * day);
    expect((await validateSession(token, { db, now: at14 }))?.renewed).toBe(false);
    const at20 = new Date(t0.getTime() + 20 * day);
    const renewed = await validateSession(token, { db, now: at20 });
    expect(renewed?.renewed).toBe(true);
    expect(renewed?.expiresAt.getTime()).toBe(at20.getTime() + 30 * day);
    const at40 = new Date(t0.getTime() + 40 * day);
    expect(await validateSession(token, { db, now: at40 })).not.toBeNull();
  });

  it("deletes a single session on log out", async () => {
    const a = await createSession(userId, { db, now: t0 });
    const b = await createSession(userId, { db, now: t0 });
    await deleteSession(a.token, { db });
    expect(await validateSession(a.token, { db, now: t0 })).toBeNull();
    expect(await validateSession(b.token, { db, now: t0 })).not.toBeNull();
  });

  it("deletes every session of a user", async () => {
    const a = await createSession(userId, { db, now: t0 });
    const b = await createSession(userId, { db, now: t0 });
    await deleteUserSessions(userId, { db });
    expect(await validateSession(a.token, { db, now: t0 })).toBeNull();
    expect(await validateSession(b.token, { db, now: t0 })).toBeNull();
  });

  it("removes sessions when the user is deleted", async () => {
    await createSession(userId, { db, now: t0 });
    await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [userId] });
    expect((await db.execute("SELECT 1 FROM auth_sessions")).rows).toHaveLength(0);
  });
});

describe("rate limiter", () => {
  it("allows the limit then blocks with a retry time", () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 5, windowMs: 600_000, now: () => now });
    for (let i = 0; i < 5; i++) expect(limiter.check("k").allowed).toBe(true);
    now += 1_000;
    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(599_000);
  });

  it("recovers after the window passes", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    limiter.check("k");
    limiter.check("k");
    expect(limiter.check("k").allowed).toBe(false);
    now += 1_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("keeps keys independent and supports reset", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => 0 });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
    limiter.reset("a");
    expect(limiter.check("a").allowed).toBe(true);
  });
});
