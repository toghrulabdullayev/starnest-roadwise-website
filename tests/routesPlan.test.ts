import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { anonymous, bearer, fixture, newPlayer } from "./helpers/api";
import type { GenerateJson } from "@/lib/ai/llm";
import { ingestDrive } from "@/lib/drives/ingest";
import { createPlan, latestPlan } from "@/lib/learning/plans";
import { query } from "@/lib/db";
import { POST as postPlan } from "@/app/api/me/plan/route";
import { GET as getLatest } from "@/app/api/me/plan/latest/route";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  await useTempDb();
});

describe("POST /api/me/plan and GET /api/me/plan/latest", () => {
  it("rejects callers without a token", async () => {
    expect((await postPlan(anonymous("POST"))).status).toBe(401);
    expect((await getLatest(anonymous())).status).toBe(401);
  });

  it("returns 404 before any plan exists", async () => {
    const { token } = await newPlayer();
    const res = await getLatest(bearer(token));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("stores a fallback plan in the player's locale when no AI key is configured", async () => {
    const { user, token } = await newPlayer("ru");
    await ingestDrive(user, fixture("progress_series_1"));

    const res = await postPlan(bearer(token, { method: "POST", body: {} }));
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created).toMatchObject({ locale: "ru", status: "fallback" });
    expect(created.plan.priorities.length).toBeGreaterThan(0);
    expect(created.practice_tags).toEqual(created.plan.priorities.map((p: { rule: string }) => p.rule));
    expect(created.plan.summary).toMatch(/[А-Яа-я]/);

    const latest = await (await getLatest(bearer(token))).json();
    expect(latest.id).toBe(created.id);
  });

  it("honours a locale in the body and filters latest by locale", async () => {
    const { user, token } = await newPlayer("en");
    await ingestDrive(user, fixture("progress_series_1"));
    const az = await (await postPlan(bearer(token, { method: "POST", body: { locale: "az" } }))).json();
    expect(az.locale).toBe("az");
    expect((await getLatest(bearer(token))).status).toBe(200);
    const en = new Request("http://localhost:3000/api/me/plan/latest?locale=en", { headers: { authorization: `Bearer ${token}` } });
    expect((await getLatest(en)).status).toBe(404);
  });

  it("gives a new player an empty plan without calling the model", async () => {
    const { token } = await newPlayer();
    const body = await (await postPlan(bearer(token, { method: "POST" }))).json();
    expect(body.plan.priorities).toEqual([]);
    expect(body.practice_tags).toEqual([]);
  });

  it("limits plan generation per user", async () => {
    const { token } = await newPlayer();
    for (let i = 0; i < 5; i++) expect((await postPlan(bearer(token, { method: "POST" }))).status).toBe(200);
    const res = await postPlan(bearer(token, { method: "POST" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

});

describe("createPlan with the model", () => {
  it("stores a model plan with its usage", async () => {
    const { user } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));

    const generate: GenerateJson = async (req) => {
      const input = JSON.parse(req.input) as { focus: { rule: string }[] };
      return {
        text: JSON.stringify({
          summary: "Work on the rules you repeat.",
          priorities: input.focus.map((f) => ({ rule: f.rule, why: "You repeat it.", practice: "Practise it on a quiet street." })),
        }),
        model: "fake-model",
        inputTokens: 40,
        outputTokens: 20,
        latencyMs: 3,
      };
    };
    const stored = await createPlan(user.id, "en", { generate, configured: true });
    expect(stored.status).toBe("ready");
    expect((await latestPlan(user.id))?.id).toBe(stored.id);
    const [row] = await query<{ model: string; input_tokens: number; attempts: number }>(
      "SELECT model, input_tokens, attempts FROM practice_plans WHERE id = ?",
      [stored.id],
    );
    expect(row).toMatchObject({ model: "fake-model", input_tokens: 40, attempts: 1 });
  });
});
