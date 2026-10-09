import { readFileSync } from "node:fs";
import { issueGameToken } from "@/lib/auth/gameToken";
import { createUser, type User } from "@/lib/auth/users";
import { parseTelemetry, type DriveTelemetry } from "@/lib/telemetry/schema";
import type { Locale } from "@/lib/i18n/config";

export function fixture(name: string): DriveTelemetry {
  const parsed = parseTelemetry(JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8")));
  if (!parsed.ok) throw new Error(`bad fixture ${name}`);
  return parsed.data;
}

let counter = 0;

export async function newPlayer(locale: Locale = "en"): Promise<{ user: User; token: string }> {
  const user = await createUser({
    email: `player${++counter}-${Date.now()}@example.com`,
    password: "password123",
    displayName: "Player",
    locale,
  });
  return { user, token: await issueGameToken(user.id, "test") };
}

export function bearer(token: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const { method = "GET", body, headers = {} } = init;
  return new Request("http://localhost:3000/api/test", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const anonymous = (method = "GET", body?: unknown): Request =>
  new Request("http://localhost:3000/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
