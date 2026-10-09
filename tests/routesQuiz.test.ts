import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { anonymous, bearer, fixture, newPlayer } from "./helpers/api";
import { ingestDrive } from "@/lib/drives/ingest";
import { query } from "@/lib/db";
import { computeFocus } from "@/lib/profile/focus";
import { GET as getFocus } from "@/app/api/me/focus/route";
import { GET as getNext } from "@/app/api/quiz/next/route";
import { POST as postAnswer } from "@/app/api/quiz/answer/route";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  await useTempDb();
});

type PublicQuestion = { id: string; rule: string; text: string; options: string[] };

async function startQuiz(token: string) {
  const res = await getNext(bearer(token));
  expect(res.status).toBe(200);
  return (await res.json()) as { quiz_id: string; locale: string; weak_rules: string[]; questions: PublicQuestion[] };
}

async function correctIndexes(quizId: string): Promise<Map<string, number>> {
  const [row] = await query<{ questions: string }>("SELECT questions FROM quiz_attempts WHERE id = ?", [quizId]);
  const questions = JSON.parse(row.questions) as { id: string; correct_index: number }[];
  return new Map(questions.map((q) => [q.id, q.correct_index]));
}

const answer = (token: string, body: unknown) => postAnswer(bearer(token, { method: "POST", body }));

describe("GET /api/quiz/next", () => {
  it("rejects callers without a token", async () => {
    expect((await getNext(anonymous())).status).toBe(401);
  });

  it("serves ten questions without revealing the answers", async () => {
    const { token } = await newPlayer("ru");
    const quiz = await startQuiz(token);
    expect(quiz.locale).toBe("ru");
    expect(quiz.questions).toHaveLength(10);
    for (const q of quiz.questions) {
      expect(Object.keys(q).sort()).toEqual(["id", "options", "rule", "text"]);
      expect(q.options).toHaveLength(4);
    }
    expect(JSON.stringify(quiz)).not.toContain("correct_index");
    expect(JSON.stringify(quiz)).not.toContain("explanation");
  });

  it("leans toward the player's weak rules", async () => {
    const { user, token } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));
    const focusRules = (await (await getFocus(bearer(token))).json()).focus.map((f: { rule: string }) => f.rule);
    const quiz = await startQuiz(token);
    const weak = quiz.questions.filter((q) => focusRules.includes(q.rule)).length;
    expect(weak).toBeGreaterThanOrEqual(7);
  });
});

describe("POST /api/quiz/answer", () => {
  it("rejects callers without a token and bad bodies", async () => {
    expect((await postAnswer(anonymous("POST", {}))).status).toBe(401);
    const { token } = await newPlayer();
    const res = await answer(token, { quiz_id: "x", answers: [{ question_id: "a", chosen_index: 9 }] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_request");
  });

  it("scores a perfect quiz and reveals correct answers and explanations", async () => {
    const { token } = await newPlayer();
    const quiz = await startQuiz(token);
    const correct = await correctIndexes(quiz.quiz_id);
    const res = await answer(token, {
      quiz_id: quiz.quiz_id,
      answers: quiz.questions.map((q) => ({ question_id: q.id, chosen_index: correct.get(q.id) })),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ quiz_id: quiz.quiz_id, correct: 10, total: 10 });
    expect(body.results.every((r: { correct: boolean; explanation: string }) => r.correct && r.explanation.length > 0)).toBe(true);
  });

  it("allows one submission only", async () => {
    const { token } = await newPlayer();
    const quiz = await startQuiz(token);
    const body = { quiz_id: quiz.quiz_id, answers: [] };
    expect((await answer(token, body)).status).toBe(200);
    const again = await answer(token, body);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_answered" });
  });

  it("does not let another player answer or see a quiz", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const quiz = await startQuiz(a.token);
    const res = await answer(b.token, { quiz_id: quiz.quiz_id, answers: [] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await answer(a.token, { quiz_id: "missing", answers: [] })).status).toBe(404);
  });

  it("counts unanswered questions as wrong and feeds them into the weakness profile", async () => {
    const { token } = await newPlayer();
    expect((await (await getFocus(bearer(token))).json()).focus).toEqual([]);

    const quiz = await startQuiz(token);
    const res = await answer(token, { quiz_id: quiz.quiz_id, answers: [] });
    const body = await res.json();
    expect(body.correct).toBe(0);
    expect(body.results.every((r: { chosen_index: number | null }) => r.chosen_index === null)).toBe(true);

    const { focus } = await (await getFocus(bearer(token))).json();
    expect(focus.length).toBeGreaterThan(0);
    for (const f of focus) expect(f.weight).toBeLessThanOrEqual(f.count * 0.5 + 1e-9);
    const total = focus.reduce((n: number, f: { count: number }) => n + f.count, 0);
    expect(total).toBe(10);
  });
});

describe("quiz signal in computeFocus", () => {
  it("decays on its own timeline and never changes the weight of real drive faults", () => {
    const drive = { drive_id: "d", started_at: "2026-10-01T00:00:00Z", faults: [{ rule: "red_light" as const, severity: "major" as const }] };
    const quiz = { drive_id: "q", started_at: "2026-10-02T00:00:00Z", faults: [{ rule: "stop_sign" as const, severity: "quiz" as const }] };
    const alone = computeFocus([drive]);
    const together = computeFocus([drive], [quiz]);
    expect(together.find((f) => f.rule === "red_light")).toEqual(alone[0]);
    expect(together.find((f) => f.rule === "stop_sign")).toMatchObject({ weight: 0.5, count: 1, trend: "same" });
  });
});
