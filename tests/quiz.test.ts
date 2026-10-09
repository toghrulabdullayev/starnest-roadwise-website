import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerateJson } from "../lib/ai/gemini";
import { generateQuizQuestions, QUIZ_MAX_ATTEMPTS } from "../lib/ai/quiz/generator";
import { buildQuizGenInput } from "../lib/ai/quiz/input";
import { validateGeneratedQuiz } from "../lib/ai/quiz/grounding";
import { locales } from "../lib/i18n/config";
import { computeFocus } from "../lib/profile/focus";
import { buildQuiz } from "../lib/quiz/build";
import { bankQuestions, templateQuestions } from "../lib/quiz/questions";
import { quizMistakesAsFaults, scoreQuiz } from "../lib/quiz/score";
import { RULE_KEYS } from "../lib/rules/catalog";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import az from "../messages/az.json";

const dicts = { en: en.quiz, ru: ru.quiz, az: az.quiz };

describe("question bank and templates", () => {
  it.each(locales)("bank in %s covers every rule with valid questions", (locale) => {
    const qs = bankQuestions(locale);
    expect(new Set(qs.map((q) => q.rule))).toEqual(new Set(RULE_KEYS));
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.correct_index).toBeGreaterThanOrEqual(0);
      expect(q.correct_index).toBeLessThan(4);
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.explanation.length).toBeGreaterThan(0);
    }
    if (locale === "ru") expect(qs[0].text).toMatch(/[А-Яа-я]/);
  });

  it("uses the same ids in every language", () => {
    const ids = locales.map((l) => bankQuestions(l).map((q) => q.id));
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
  });

  it.each(locales)("templates in %s come from the catalog", (locale) => {
    const qs = templateQuestions(locale, dicts[locale]);
    const byId = new Map(qs.map((q) => [q.id, q]));
    expect(byId.get("tpl:fine:red_light")!.options[0]).toContain("100");
    expect(byId.get("tpl:fine:wrong_way")!.options[0]).toContain("150");
    expect(byId.get("tpl:limit:city")!.options[0]).toContain("60");
    expect(byId.get("tpl:limit:motorway")!.options[0]).toContain("110");
    expect(byId.has("tpl:fine:give_way")).toBe(false);
    expect(byId.has("tpl:fine:collision")).toBe(false);
    expect(byId.has("tpl:fine:speeding")).toBe(false);
    expect(byId.has("tpl:severity:speeding")).toBe(false);
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.correct_index).toBe(0);
    }
  });
});

describe("buildQuiz", () => {
  const base = { locale: "en" as const, dictionary: en.quiz };

  it("builds ten unique, valid questions deterministically", () => {
    const a = buildQuiz({ ...base, seed: 7 });
    const b = buildQuiz({ ...base, seed: 7 });
    expect(a).toEqual(b);
    expect(a.questions).toHaveLength(10);
    expect(new Set(a.questions.map((q) => q.id)).size).toBe(10);
    for (const q of a.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correct_index).toBeLessThan(4);
    }
    expect(buildQuiz({ ...base, seed: 8 }).id).not.toBe(a.id);
  });

  it("keeps the correct answer text when it shuffles options", () => {
    const original = new Map(
      [...bankQuestions("en"), ...templateQuestions("en", en.quiz)].map((q) => [
        q.id,
        q.options[q.correct_index],
      ]),
    );
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const q of buildQuiz({ ...base, seed }).questions) {
        expect(q.options[q.correct_index]).toBe(original.get(q.id));
      }
    }
  });

  it("leans toward the weak rules", () => {
    const focus = computeFocus([
      { drive_id: "a", started_at: "2026-10-01T00:00:00Z", faults: [{ rule: "red_light", severity: "major" }] },
    ]);
    const quiz = buildQuiz({ ...base, seed: 3, focus });
    const redLight = quiz.questions.filter((q) => q.rule === "red_light");
    expect(redLight.length).toBe(3);
    expect(quiz.weak_rules).toEqual(["red_light"]);
  });

  it("returns fewer questions when the pool is small", () => {
    const quiz = buildQuiz({ ...base, seed: 1, size: 100 });
    expect(quiz.questions.length).toBeLessThan(100);
    expect(quiz.questions.length).toBeGreaterThan(10);
  });

  it("adds generated questions to the pool", () => {
    const extra = [
      { id: "gen:1", rule: "collision" as const, text: "Q?", options: ["a", "b", "c", "d"], correct_index: 1, explanation: "e", source: "generated" as const },
    ];
    const quiz = buildQuiz({ ...base, seed: 1, size: 100, extra });
    expect(quiz.questions.some((q) => q.id === "gen:1")).toBe(true);
  });
});

describe("scoring and the quiz signal", () => {
  const quiz = buildQuiz({ locale: "en", dictionary: en.quiz, seed: 11, size: 4 });

  it("scores all-correct, partial and unanswered", () => {
    const all = scoreQuiz(quiz, quiz.questions.map((q) => ({ question_id: q.id, chosen_index: q.correct_index })));
    expect(all).toMatchObject({ correct: 4, total: 4, wrong: [] });

    const first = quiz.questions[0];
    const partial = scoreQuiz(quiz, [
      { question_id: first.id, chosen_index: (first.correct_index + 1) % 4 },
      ...quiz.questions.slice(1).map((q) => ({ question_id: q.id, chosen_index: q.correct_index })),
    ]);
    expect(partial.correct).toBe(3);
    expect(partial.wrong_by_rule[first.rule]).toBe(1);

    const none = scoreQuiz(quiz, []);
    expect(none.correct).toBe(0);
    expect(none.wrong).toHaveLength(4);
  });

  it("counts wrong answers as a smaller signal than a real fault", () => {
    const result = scoreQuiz(quiz, []);
    const focusQuizOnly = computeFocus([quizMistakesAsFaults(result, quiz.id, "2026-10-09T10:00:00Z")]);
    expect(focusQuizOnly.length).toBeGreaterThan(0);
    for (const f of focusQuizOnly) expect(f.weight).toBeLessThanOrEqual(f.count * 0.5 + 1e-9);

    const minor = computeFocus([
      { drive_id: "d", started_at: "2026-10-09T10:00:00Z", faults: [{ rule: "stop_sign", severity: "minor" }] },
    ]);
    expect(minor[0].weight).toBe(1);
    expect(0.5).toBeLessThan(minor[0].weight);
  });
});

function fake(responses: unknown[]) {
  const calls: string[] = [];
  let i = 0;
  const generate: GenerateJson = async (req) => {
    calls.push(req.input);
    const body = responses[Math.min(i++, responses.length - 1)];
    return { text: JSON.stringify(body), model: "fake", inputTokens: 10, outputTokens: 5, latencyMs: 1 };
  };
  return { generate, calls };
}

const goodQuestion = (overrides: Record<string, unknown> = {}) => ({
  rule: "red_light",
  question: "A light turns red as you approach the junction. What do you do?",
  options: ["Stop before the stop line", "Speed up", "Honk", "Close your eyes"],
  correct_index: 0,
  explanation: "You must stop before the stop line on red.",
  ...overrides,
});

describe("generated questions", () => {
  const input = buildQuizGenInput(["red_light", "stop_sign"], 1, "en", ["Existing question?"]);
  const validate = (body: unknown) => validateGeneratedQuiz(JSON.stringify(body), input);
  const errors = (body: unknown) => {
    const r = validate(body);
    return r.ok ? [] : r.errors;
  };

  it("accepts a grounded question and tags it as generated", () => {
    const r = validate({ questions: [goodQuestion()] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.questions[0].source).toBe("generated");
      expect(r.questions[0].id).toMatch(/^gen:/);
    }
  });

  it("rejects an unrequested rule, duplicate options and repeats", () => {
    expect(errors({ questions: [goodQuestion({ rule: "wrong_way" })] }).join()).toContain("not one of the requested rules");
    expect(errors({ questions: [goodQuestion({ options: ["A", "a", "B", "C"] })] }).join()).toContain("duplicate options");
    expect(errors({ questions: [goodQuestion({ question: "Existing question?" })] }).join()).toContain("repeats");
  });

  it("rejects invented numbers but allows numbers from the input", () => {
    expect(errors({ questions: [goodQuestion({ explanation: "The fine is 77 AZN." })] }).join()).toContain('"77"');
    expect(validate({ questions: [goodQuestion({ explanation: "The fine is 100 AZN." })] }).ok).toBe(true);
  });

  it("rejects the wrong number of questions and bad schema", () => {
    expect(errors({ questions: [goodQuestion(), goodQuestion({ question: "Another one?" })] }).join()).toContain("expected exactly 1");
    expect(errors({ questions: [goodQuestion({ correct_index: 9 })] }).length).toBeGreaterThan(0);
    expect(validateGeneratedQuiz("nope", input).ok).toBe(false);
  });

  it("runs end to end with retry and falls back to nothing", async () => {
    const bad = { questions: [goodQuestion({ explanation: "The fine is 77 AZN." })] };
    const retry = fake([bad, { questions: [goodQuestion()] }]);
    const ok = await generateQuizQuestions({ rules: ["red_light"], count: 1, locale: "en", generate: retry.generate, configured: true });
    expect(ok.status).toBe("ready");
    expect(ok.attempts).toBe(2);
    expect(retry.calls[1]).toContain('"77"');

    const always = fake([bad]);
    const failed = await generateQuizQuestions({ rules: ["red_light"], count: 1, locale: "en", generate: always.generate, configured: true });
    expect(failed.status).toBe("fallback");
    expect(failed.questions).toEqual([]);
    expect(always.calls).toHaveLength(QUIZ_MAX_ATTEMPTS);
  });

  it("does not call the model without a key, rules or count", async () => {
    const f = fake([{ questions: [goodQuestion()] }]);
    await generateQuizQuestions({ rules: ["red_light"], count: 1, locale: "en", generate: f.generate, configured: false });
    await generateQuizQuestions({ rules: [], count: 1, locale: "en", generate: f.generate, configured: true });
    await generateQuizQuestions({ rules: ["red_light"], count: 0, locale: "en", generate: f.generate, configured: true });
    expect(f.calls).toHaveLength(0);
  });
});

describe("dictionaries", () => {
  it("have the quiz keys in every language", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(ru.quiz).sort()).toEqual(keys(en.quiz).sort());
    expect(keys(az.quiz).sort()).toEqual(keys(en.quiz).sort());
    expect(readFileSync(join(__dirname, "..", "lib", "quiz", "bank.json"), "utf8").length).toBeGreaterThan(0);
  });
});
