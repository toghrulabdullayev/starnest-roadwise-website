import { beforeAll, describe, expect, it } from "vitest";
import { useTempDb } from "./helpers/db";
import { createUser } from "@/lib/auth/users";
import {
  approveDevice,
  exchangeDeviceCode,
  generateUserCode,
  lookupUserCode,
  normalizeUserCode,
  startDeviceLink,
} from "@/lib/auth/deviceLink";
import { listGameTokens, requireGameUser, revokeGameToken, validateGameToken } from "@/lib/auth/gameToken";
import { queryOne } from "@/lib/db";
import { sha256 } from "@/lib/auth/tokens";

let userId: string;
beforeAll(async () => {
  await useTempDb();
  userId = (await createUser({ email: "driver@example.com", password: "password123", displayName: "Driver", locale: "az" })).id;
});

describe("user codes", () => {
  it("are XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) expect(generateUserCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("normalise user input", () => {
    expect(normalizeUserCode("abcd efgh")).toBe("ABCD-EFGH");
    expect(normalizeUserCode("ABCD-EFG0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeUserCode("short")).toBeNull();
  });
});

describe("device flow", () => {
  it("pending → approved → token, storing only hashes", async () => {
    const link = await startDeviceLink("roadwise-unity", "0.1.0");
    expect(link).toMatchObject({ interval: 3, expires_in: 600 });
    expect(await queryOne("SELECT 1 FROM device_links WHERE device_code_hash = ?", [sha256(link.device_code)])).not.toBeNull();
    expect(await queryOne("SELECT 1 FROM device_links WHERE device_code_hash = ?", [link.device_code])).toBeNull();

    expect(await exchangeDeviceCode(link.device_code)).toEqual({ ok: false, error: "authorization_pending" });
    expect((await lookupUserCode(link.user_code, userId)).state).toBe("pending");
    expect(await approveDevice(link.user_code, userId)).toBe("approved");
    const res = await exchangeDeviceCode(link.device_code);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.access_token.startsWith("rw_")).toBe(true);
    expect(res.user).toMatchObject({ id: userId, display_name: "Driver", locale: "az" });
    expect((await validateGameToken(res.access_token))?.id).toBe(userId);
    expect(await queryOne("SELECT 1 FROM game_tokens WHERE token_hash = ?", [res.access_token])).toBeNull();
  });

  it("a consumed code cannot be exchanged twice", async () => {
    const link = await startDeviceLink("roadwise-unity", "0.1.0");
    await approveDevice(link.user_code, userId);
    const [a, b] = await Promise.all([exchangeDeviceCode(link.device_code), exchangeDeviceCode(link.device_code)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await exchangeDeviceCode(link.device_code)).toEqual({ ok: false, error: "invalid_grant" });
    expect(await approveDevice(link.user_code, userId)).toBe("invalid");
  });

  it("expired codes are rejected for approval and exchange", async () => {
    const past = Date.now() - 11 * 60 * 1000;
    const link = await startDeviceLink("roadwise-unity", "0.1.0", past);
    expect((await lookupUserCode(link.user_code, userId)).state).toBe("expired");
    expect(await approveDevice(link.user_code, userId)).toBe("expired");
    expect(await exchangeDeviceCode(link.device_code)).toEqual({ ok: false, error: "expired_token" });
    expect(await exchangeDeviceCode(link.device_code)).toEqual({ ok: false, error: "expired_token" });
  });

  it("an approved code that expires before the game polls is expired", async () => {
    const link = await startDeviceLink("roadwise-unity", "0.1.0");
    await approveDevice(link.user_code, userId);
    expect(await exchangeDeviceCode(link.device_code, Date.now() + 11 * 60 * 1000)).toEqual({ ok: false, error: "expired_token" });
  });

  it("unknown device codes are invalid_grant", async () => {
    expect(await exchangeDeviceCode("nope")).toEqual({ ok: false, error: "invalid_grant" });
    expect(await exchangeDeviceCode(undefined)).toEqual({ ok: false, error: "invalid_grant" });
  });
});

describe("game tokens", () => {
  it("revoked tokens stop working", async () => {
    const link = await startDeviceLink("roadwise-unity", "0.1.0");
    await approveDevice(link.user_code, userId);
    const res = await exchangeDeviceCode(link.device_code);
    if (!res.ok) throw new Error("exchange failed");
    const req = new Request("http://x/api/me", { headers: { Authorization: `Bearer ${res.access_token}` } });
    expect((await requireGameUser(req))?.id).toBe(userId);
    const device = (await queryOne<{ id: string }>("SELECT id FROM game_tokens WHERE token_hash = ?", [sha256(res.access_token)]))!;
    expect((await listGameTokens(userId)).some((d) => d.id === device.id)).toBe(true);
    expect(await revokeGameToken(device.id, "someone-else")).toBe(false);
    expect(await revokeGameToken(device.id, userId)).toBe(true);
    expect(await requireGameUser(req)).toBeNull();
  });
  it("rejects missing and malformed bearer headers", async () => {
    expect(await requireGameUser(new Request("http://x"))).toBeNull();
    expect(await requireGameUser(new Request("http://x", { headers: { Authorization: "Bearer abc" } }))).toBeNull();
  });
});
