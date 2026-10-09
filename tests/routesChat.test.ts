import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { anonymous, bearer, fixture, newPlayer } from "./helpers/api";
import { ingestDrive } from "@/lib/drives/ingest";
import { CHAT_LIMIT } from "@/lib/ai/chat/rateLimit";
import { POST as postChat } from "@/app/api/chat/route";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  await useTempDb();
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  mode: "free",
  speed_kmh: 72,
  limit_kmh: 60,
  street: "Nizami küç.",
  recent_faults: [{ rule: "speeding", seconds_ago: 30 }],
  ...overrides,
});

const ask = (token: string, body: unknown) => postChat(bearer(token, { method: "POST", body }));

describe("POST /api/chat", () => {
  it("rejects callers without a token", async () => {
    expect((await postChat(anonymous("POST", {}))).status).toBe(401);
  });

  it("rejects bad requests with 422 and issues", async () => {
    const { token } = await newPlayer();
    const res = await ask(token, { question: "", snapshot: snapshot() });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.issues.length).toBeGreaterThan(0);
    expect((await postChat(bearer(token, { method: "POST", headers: {} }))).status).toBe(422);
  });

  it("answers from the canned fallback without a key, in the player's language", async () => {
    const { token } = await newPlayer("ru");
    const res = await ask(token, { question: "Почему штраф?", snapshot: snapshot() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "fallback", kind: "answer", rules: ["speeding"] });
    expect(body.answer).toMatch(/[А-Яа-я]/);
  });

  it("honours a locale in the body", async () => {
    const { token } = await newPlayer("en");
    const body = await (await ask(token, { question: "Why?", snapshot: snapshot({ recent_faults: [] }), locale: "az" })).json();
    expect(body.answer).toContain("nişan");
  });

  it("only refuses in an exam and never gives rule hints", async () => {
    const { user, token } = await newPlayer("en");
    await ingestDrive(user, fixture("progress_series_1"));
    const res = await ask(token, { question: "What should I do at the STOP sign?", snapshot: snapshot({ mode: "exam", recent_faults: [] }) });
    const body = await res.json();
    expect(body).toMatchObject({ kind: "refused", rules: [] });
  });

  it("limits questions per player and returns a localized message", async () => {
    const { token } = await newPlayer("ru");
    for (let i = 0; i < CHAT_LIMIT; i++) {
      expect((await ask(token, { question: "Why?", snapshot: snapshot() })).status).toBe(200);
    }
    const res = await ask(token, { question: "Why?", snapshot: snapshot() });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.message).toMatch(/[А-Яа-я]/);
    expect(res.headers.get("retry-after")).toBeTruthy();

    const other = await newPlayer();
    expect((await ask(other.token, { question: "Why?", snapshot: snapshot() })).status).toBe(200);
  });
});
