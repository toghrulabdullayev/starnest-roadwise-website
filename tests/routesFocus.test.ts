import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { anonymous, bearer, fixture, newPlayer } from "./helpers/api";
import { ingestDrive } from "@/lib/drives/ingest";
import { GET as getFocus } from "@/app/api/me/focus/route";
import { GET as getBrief } from "@/app/api/me/exam-brief/route";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  await useTempDb();
});

describe("GET /api/me/focus", () => {
  it("rejects callers without a token", async () => {
    const res = await getFocus(anonymous());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("is empty for a new player", async () => {
    const { token } = await newPlayer();
    const body = await (await getFocus(bearer(token))).json();
    expect(body).toEqual({ focus: [], drives_considered: 0 });
  });

  it("ranks recurring faults and only shows the caller's own", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await ingestDrive(a.user, fixture("progress_series_1"));
    await ingestDrive(a.user, fixture("progress_series_2"));
    await ingestDrive(b.user, fixture("clean_drive"));

    const body = await (await getFocus(bearer(a.token))).json();
    expect(body.drives_considered).toBe(2);
    expect(body.focus.length).toBeGreaterThan(0);
    const weights = body.focus.map((f: { weight: number }) => f.weight);
    expect([...weights].sort((x: number, y: number) => y - x)).toEqual(weights);

    const other = await (await getFocus(bearer(b.token))).json();
    expect(other.focus).toEqual([]);
    expect(other.drives_considered).toBe(1);
  });
});

describe("GET /api/me/exam-brief", () => {
  it("rejects callers without a token", async () => {
    expect((await getBrief(anonymous())).status).toBe(401);
  });

  it("gives a general standard brief to a new player", async () => {
    const { token } = await newPlayer();
    const { brief } = await (await getBrief(bearer(token))).json();
    expect(brief).toMatchObject({ reason: "no_history", difficulty: "standard", focus_rules: [] });
  });

  it("targets the weak rules of a struggling player and pushes a clean one", async () => {
    const weak = await newPlayer();
    await ingestDrive(weak.user, fixture("progress_series_1"));
    const { brief } = await (await getBrief(bearer(weak.token))).json();
    expect(brief.reason).toBe("weaknesses");
    expect(brief.focus_rules.length).toBeGreaterThan(0);

    const clean = await newPlayer();
    await ingestDrive(clean.user, fixture("clean_drive"));
    const cleanBrief = (await (await getBrief(bearer(clean.token))).json()).brief;
    expect(cleanBrief).toMatchObject({ reason: "clean", difficulty: "hard" });
  });
});
