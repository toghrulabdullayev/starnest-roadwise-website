import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { fixture, newPlayer } from "./helpers/api";
import type { User } from "@/lib/auth/users";
import { ingestDrive } from "@/lib/drives/ingest";
import { latestPlan } from "@/lib/learning/plans";
import { getLearningData } from "@/lib/learning/page";
import { query } from "@/lib/db";

const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { buildPlanAction, startQuizAction, submitQuizAction } from "@/app/actions/learning";

beforeAll(async () => {
  await useTempDb();
});

beforeEach(() => {
  session.user = null;
});

const form = (locale: string) => {
  const f = new FormData();
  f.set("locale", locale);
  return f;
};

describe("buildPlanAction", () => {
  it("refuses signed-out visitors", async () => {
    expect(await buildPlanAction({}, form("en"))).toEqual({ error: "generic" });
  });

  it("stores a plan for the page's locale and reports done", async () => {
    const { user } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));
    session.user = user;
    expect(await buildPlanAction({}, form("ru"))).toEqual({ done: true });
    const plan = await latestPlan(user.id, "ru");
    expect(plan?.plan.priorities.length).toBeGreaterThan(0);
    expect(await latestPlan(user.id, "en")).toBeNull();
  });

  it("is limited to five plans a minute", async () => {
    const { user } = await newPlayer();
    session.user = user;
    for (let i = 0; i < 5; i++) expect(await buildPlanAction({}, form("en"))).toEqual({ done: true });
    expect(await buildPlanAction({}, form("en"))).toEqual({ error: "rate_limited" });
  });
});

describe("quiz actions", () => {
  it("refuses signed-out visitors", async () => {
    expect(await startQuizAction("en")).toEqual({ ok: false });
    expect(await submitQuizAction("x", [])).toEqual({ ok: false });
  });

  it("starts a quiz without answers, scores it and keeps it single-use", async () => {
    const { user } = await newPlayer();
    session.user = user;

    const started = await startQuizAction("az");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.quiz.locale).toBe("az");
    expect(started.quiz.questions).toHaveLength(10);
    expect(JSON.stringify(started.quiz)).not.toContain("correct_index");

    const [row] = await query<{ questions: string }>("SELECT questions FROM quiz_attempts WHERE id = ?", [started.quiz.quiz_id]);
    const stored = JSON.parse(row.questions) as { id: string; correct_index: number }[];
    const answers = stored.map((q, i) => ({ question_id: q.id, chosen_index: i < 8 ? q.correct_index : (q.correct_index + 1) % 4 }));

    const submitted = await submitQuizAction(started.quiz.quiz_id, answers);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.result).toMatchObject({ correct: 8, total: 10 });

    expect(await submitQuizAction(started.quiz.quiz_id, answers)).toEqual({ ok: false });
  });

  it("ignores malformed answers instead of failing", async () => {
    const { user } = await newPlayer();
    session.user = user;
    const started = await startQuizAction("en");
    if (!started.ok) throw new Error("no quiz");
    const result = await submitQuizAction(started.quiz.quiz_id, [
      { question_id: started.quiz.questions[0].id, chosen_index: 99 },
      { question_id: 5 as unknown as string, chosen_index: 0 },
    ]);
    expect(result.ok && result.result.correct).toBe(0);
  });
});

describe("getLearningData", () => {
  it("is empty and standard for a new player, and fills in after drives, a plan and a quiz", async () => {
    const { user } = await newPlayer();
    const empty = await getLearningData(user.id, "en");
    expect(empty).toMatchObject({ focus: [], plan: null, lastQuiz: null });
    expect(empty.brief.reason).toBe("no_history");

    await ingestDrive(user, fixture("progress_series_1"));
    session.user = user;
    await buildPlanAction({}, form("en"));
    const started = await startQuizAction("en");
    if (!started.ok) throw new Error("no quiz");
    await submitQuizAction(started.quiz.quiz_id, []);

    const full = await getLearningData(user.id, "en");
    expect(full.focus.length).toBeGreaterThan(0);
    expect(full.brief.reason).toBe("weaknesses");
    expect(full.plan?.status).toBe("fallback");
    expect(full.lastQuiz).toMatchObject({ correct: 0, total: 10 });
    expect((await getLearningData(user.id, "ru")).plan).toBeNull();
  });
});
