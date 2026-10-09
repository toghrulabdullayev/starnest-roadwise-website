/**
 * Contract A — device-link login (roadwise-platform §7).
 * Only SHA-256 hashes of device codes are stored. User codes are 8 chars, shown XXXX-XXXX.
 */
import { randomInt, randomUUID } from "node:crypto";
import { queryOne, run } from "@/lib/db";
import { issueGameToken } from "./gameToken";
import { randomToken, sha256 } from "./tokens";
import { findUserById, type User } from "./users";

export const DEVICE_LINK_TTL_S = 600;
export const POLL_INTERVAL_S = 3;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateUserCode(): string {
  const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** "abcd efgh" / "ABCDEFGH" / "abcd-efgh" → "ABCD-EFGH"; null when it cannot be a code. */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 8 || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export async function startDeviceLink(
  client: string | null,
  clientVersion: string | null,
  now = Date.now(),
): Promise<{ device_code: string; user_code: string; expires_in: number; interval: number }> {
  const deviceCode = randomToken(32);
  const expiresAt = new Date(now + DEVICE_LINK_TTL_S * 1000).toISOString();
  for (let attempt = 0; ; attempt++) {
    const userCode = generateUserCode();
    try {
      await run(
        "INSERT INTO device_links (id, device_code_hash, user_code, client, client_version, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), sha256(deviceCode), userCode, client, clientVersion, expiresAt],
      );
      return { device_code: deviceCode, user_code: userCode, expires_in: DEVICE_LINK_TTL_S, interval: POLL_INTERVAL_S };
    } catch (err) {
      // user_code collision: old rows keep their codes; free expired ones and retry
      if (attempt >= 4 || !String(err).includes("UNIQUE")) throw err;
      await run("DELETE FROM device_links WHERE user_code = ? AND expires_at < ?", [userCode, new Date(now).toISOString()]);
    }
  }
}

type LinkRow = { id: string; status: string; expires_at: string; user_id: string | null; client: string | null; client_version: string | null };

export type LinkLookup =
  | { state: "pending"; client: string | null; clientVersion: string | null }
  | { state: "approved"; client: string | null; mine: boolean }
  | { state: "expired" }
  | { state: "invalid" };

/** For the /link page. */
export async function lookupUserCode(userCode: string | null, viewerId: string | null, now = Date.now()): Promise<LinkLookup> {
  if (!userCode) return { state: "invalid" };
  const row = await queryOne<LinkRow>(
    "SELECT id, status, expires_at, user_id, client, client_version FROM device_links WHERE user_code = ?",
    [userCode],
  );
  if (!row) return { state: "invalid" };
  if (row.status === "approved" || row.status === "consumed") return { state: "approved", client: row.client, mine: row.user_id === viewerId };
  if (row.status === "expired" || new Date(row.expires_at).getTime() <= now) return { state: "expired" };
  return { state: "pending", client: row.client, clientVersion: row.client_version };
}

/** Pending + unexpired → approved for this user. */
export async function approveDevice(
  userCode: string,
  userId: string,
  now = Date.now(),
): Promise<"approved" | "expired" | "invalid"> {
  const changed = await run(
    "UPDATE device_links SET status = 'approved', user_id = ? WHERE user_code = ? AND status = 'pending' AND expires_at > ?",
    [userId, userCode, new Date(now).toISOString()],
  );
  if (changed === 1) return "approved";
  const row = await queryOne<LinkRow>("SELECT status, expires_at FROM device_links WHERE user_code = ?", [userCode]);
  if (!row) return "invalid";
  if (row.status === "expired" || (row.status === "pending" && new Date(row.expires_at).getTime() <= now)) return "expired";
  return "invalid";
}

export type TokenResult =
  | { ok: true; access_token: string; user: User }
  | { ok: false; error: "authorization_pending" | "expired_token" | "invalid_grant" };

/** POST /api/device/token. Approved → consumed (atomically) → game token. */
export async function exchangeDeviceCode(deviceCode: unknown, now = Date.now()): Promise<TokenResult> {
  if (typeof deviceCode !== "string" || !deviceCode) return { ok: false, error: "invalid_grant" };
  const row = await queryOne<LinkRow>(
    "SELECT id, status, expires_at, user_id, client FROM device_links WHERE device_code_hash = ?",
    [sha256(deviceCode)],
  );
  if (!row) return { ok: false, error: "invalid_grant" };
  const expired = new Date(row.expires_at).getTime() <= now;
  if (row.status === "expired") return { ok: false, error: "expired_token" };
  if ((row.status === "pending" || row.status === "approved") && expired) {
    await run("UPDATE device_links SET status = 'expired' WHERE id = ?", [row.id]);
    return { ok: false, error: "expired_token" };
  }
  if (row.status === "pending") return { ok: false, error: "authorization_pending" };
  if (row.status !== "approved" || !row.user_id) return { ok: false, error: "invalid_grant" };

  // Only one poll can win the approved → consumed transition.
  const won = await run("UPDATE device_links SET status = 'consumed' WHERE id = ? AND status = 'approved'", [row.id]);
  if (won !== 1) return { ok: false, error: "invalid_grant" };
  const user = await findUserById(row.user_id);
  if (!user) return { ok: false, error: "invalid_grant" };
  const access_token = await issueGameToken(user.id, row.client);
  return { ok: true, access_token, user };
}
