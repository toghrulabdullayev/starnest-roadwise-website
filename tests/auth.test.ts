import { beforeAll, describe, expect, it } from "vitest";
import { useTempDb } from "./helpers/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { RateLimiter } from "@/lib/auth/rateLimit";
import { SESSION_TTL_MS, createSession, deleteSession, validateSession } from "@/lib/auth/session";
import { EmailTakenError, changePassword, createUser, findUserByEmail } from "@/lib/auth/users";
import { queryOne } from "@/lib/db";
import { sha256 } from "@/lib/auth/tokens";

const DAY = 24 * 60 * 60 * 1000;

describe("password", () => {
  it("hashes in the scrypt$N$r$p$salt$hash format and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse", h)).toBe(true);
  });
  it("rejects a wrong password and malformed hashes", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("wrong horse", h)).toBe(false);
    expect(await verifyPassword("correct horse", "plain")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("rate limiter", () => {
  it("allows 5 tries per window, then blocks until the window passes", () => {
    const rl = new RateLimiter(5, 10 * 60 * 1000);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rl.hit("a@b|1.2.3.4", t0 + i).allowed).toBe(true);
    const blocked = rl.hit("a@b|1.2.3.4", t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThan(0);
    expect(rl.hit("other|1.2.3.4", t0 + 10).allowed).toBe(true);
    expect(rl.hit("a@b|1.2.3.4", t0 + 10 * 60 * 1000 + 1).allowed).toBe(true);
  });
  it("reset clears a key", () => {
    const rl = new RateLimiter(1, 1000);
    rl.hit("k", 0);
    expect(rl.hit("k", 1).allowed).toBe(false);
    rl.reset("k");
    expect(rl.hit("k", 2).allowed).toBe(true);
  });
});

describe("sessions", () => {
  let userId: string;
  beforeAll(async () => {
    await useTempDb();
    userId = (await createUser({ email: " Student@Example.com ", password: "password123", displayName: "Student", locale: "en" })).id;
  });

  it("lower-cases emails and refuses duplicates", async () => {
    expect((await findUserByEmail("student@example.com"))?.id).toBe(userId);
    await expect(createUser({ email: "STUDENT@example.com", password: "password123", displayName: "X", locale: "en" })).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });

  it("stores only the token hash and validates the token", async () => {
    const { token } = await createSession(userId, "vitest");
    const row = await queryOne<{ token_hash: string }>("SELECT token_hash FROM auth_sessions WHERE token_hash = ?", [sha256(token)]);
    expect(row?.token_hash).toBe(sha256(token));
    expect((await validateSession(token))?.user.id).toBe(userId);
    expect(await validateSession("not-a-token")).toBeNull();
  });

  it("expires after 30 days and deletes the row", async () => {
    const now = Date.now();
    const { token } = await createSession(userId, null, now);
    expect(await validateSession(token, now + SESSION_TTL_MS + 1)).toBeNull();
    expect(await queryOne("SELECT 1 FROM auth_sessions WHERE token_hash = ?", [sha256(token)])).toBeNull();
  });

  it("renews (sliding) when fewer than 15 days remain", async () => {
    const now = Date.now();
    const { token, expiresAt } = await createSession(userId, null, now);
    const fresh = await validateSession(token, now + 1 * DAY);
    expect(fresh?.renewedUntil).toBeNull();
    const later = now + 20 * DAY;
    const renewed = await validateSession(token, later);
    expect(renewed?.renewedUntil?.getTime()).toBe(later + SESSION_TTL_MS);
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
  });

  it("log out deletes the session", async () => {
    const { token } = await createSession(userId);
    await deleteSession(token);
    expect(await validateSession(token)).toBeNull();
  });

  it("changing the password deletes all sessions", async () => {
    const a = await createSession(userId);
    const b = await createSession(userId);
    await changePassword(userId, "new-password-1");
    expect(await validateSession(a.token)).toBeNull();
    expect(await validateSession(b.token)).toBeNull();
  });
});
