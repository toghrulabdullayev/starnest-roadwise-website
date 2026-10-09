/**
 * Evaluation of the learning loop and the live instructor (plan 8.7).
 *   npm run eval:learning                          plan, quiz generation, chat, exam brief
 *   npm run eval:learning -- --runs 1 --locales en --sections plan,chat
 * Writes eval/learning-report.json and eval/LEARNING_REPORT.md from this run only — no hand-written numbers.
 * Model sections call the real model (OPENROUTER_API_KEY); the brief and quiz-builder sections are deterministic.
 * --fake-llm is a harness self-test without the network and is never used for the real report.
 */
import "../scripts/env";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import en from "../messages/en.json";
import { aiModel, generateJson, type GenerateJson } from "../lib/ai/llm";
import { answerDrivingQuestion } from "../lib/ai/chat/responder";
import { generateLearningPlan } from "../lib/ai/plan/planner";
import { generateQuizQuestions } from "../lib/ai/quiz/generator";
import { buildExamBrief } from "../lib/exam/adaptive";
import { locales as ALL_LOCALES, type Locale } from "../lib/i18n/config";
import { compareExamWithBrief } from "../lib/profile/compare";
import { faultsFromTelemetry, focusFromTelemetry, type FocusEntry } from "../lib/profile/focus";
import { buildQuiz } from "../lib/quiz/build";
import { bankQuestions } from "../lib/quiz/questions";
import { RULES, RULE_KEYS, SPEED_LIMITS, type RuleKey } from "../lib/rules/catalog";
import { parseTelemetry, type DriveTelemetry } from "../lib/telemetry/schema";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const RUNS = Number(arg("runs") ?? 2);
const LOCALES = (arg("locales")?.split(",") ?? [...ALL_LOCALES]) as Locale[];
const SECTIONS = arg("sections")?.split(",") ?? ["plan", "quiz", "chat", "brief"];
const OUT = arg("out") ?? "eval";
const FAKE = process.argv.includes("--fake-llm");
const CONCURRENCY = 4;

const fx = (n: string): DriveTelemetry => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(`fixture ${n} invalid`);
  return r.data;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const quant = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

async function pool<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
        process.stdout.write(".");
      }
    }),
  );
  return out;
}

function languageOk(text: string, locale: Locale): boolean {
  const cleaned = text.replace(/küç\.?/gi, " ");
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  const cyr = letters.filter((ch) => /\p{Script=Cyrillic}/u.test(ch)).length / Math.max(1, letters.length);
  if (locale === "ru") return cyr > 0.6;
  if (locale === "az") return cyr < 0.1 && /[əğıƏĞİ]/.test(cleaned);
  return cyr < 0.05 && !/[əğı]/.test(cleaned);
}

interface Usage {
  attempts: number;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  validation_errors: string[][];
}

const isSchemaError = (e: string) => e.startsWith("schema:") || e.includes("not valid JSON");
const isInvented = (e: string) => e.includes("does not appear in the input");
const firstTryClean = (u: Usage, status: string) => status === "ready" && u.attempts === 1;

// ---------- fake model (self-test only) ----------
function fakeGenerate(): GenerateJson {
  return async ({ system, input }) => {
    const data = JSON.parse(input.split("\n\n")[0]);
    let body: unknown;
    if (system.includes("learning plan")) {
      body = {
        summary: "Work on the faults you repeat.",
        priorities: data.focus.map((f: { rule: string }) => ({ rule: f.rule, why: "You repeat this fault.", practice: "Practise it on a quiet street." })),
      };
    } else if (system.includes("multiple-choice")) {
      body = {
        questions: Array.from({ length: data.count }, (_, i) => ({
          rule: data.rules[i % data.rules.length].key,
          question: `Fake question ${i + 1}?`,
          options: ["A", "B", "C", "D"],
          correct_index: i % 4,
          explanation: "Because.",
        })),
      };
    } else {
      body = data.mode === "exam"
        ? data.snapshot.next_instruction
          ? { kind: "directions", answer: data.snapshot.next_instruction, rules: [] }
          : { kind: "refused", answer: "I can only help with directions.", rules: [] }
        : { kind: "answer", answer: "Keep to the speed limit.", rules: [] };
    }
    return { text: JSON.stringify(body), model: "fake-llm", inputTokens: 400, outputTokens: 120, latencyMs: 5 };
  };
}
const configured = FAKE ? true : undefined;

/** Wraps the model call so a job can keep the raw text of every attempt (shown for rejected first attempts). */
function recorder(): { generate: GenerateJson; outputs: string[] } {
  const outputs: string[] = [];
  const base = FAKE ? fakeGenerate() : generateJson;
  const generate: GenerateJson = async (req) => {
    const out = await base(req);
    outputs.push(out.text);
    return out;
  };
  return { generate, outputs };
}

// ---------- PLAN ----------
const PLAN_SETS: Record<string, string[]> = {
  series_1: ["progress_series_1"],
  series_1_2: ["progress_series_1", "progress_series_2"],
  series_1_2_3: ["progress_series_1", "progress_series_2", "progress_series_3"],
  speeder: ["speeder"],
  red_light_runner: ["red_light_runner"],
  exam_fail_and_speeder: ["mixed_exam_fail", "speeder"],
};

interface PlanRecord extends Usage {
  set: string;
  locale: Locale;
  run: number;
  status: string;
  first_try_clean: boolean;
  first_schema_ok: boolean | null;
  first_invented_number: boolean | null;
  first_errors: string[];
  first_raw: string | null;
  covers_all: boolean;
  top_matches_heaviest: boolean | null;
  language_ok: boolean;
  wrong_severity_claims: number | null;
}

async function evalPlan(): Promise<PlanRecord[]> {
  const jobs: (() => Promise<PlanRecord>)[] = [];
  for (const [set, names] of Object.entries(PLAN_SETS))
    for (const locale of LOCALES)
      for (let run = 1; run <= RUNS; run++)
        jobs.push(async () => {
          const focus = focusFromTelemetry(names.map(fx));
          const rec = recorder();
          const r = await generateLearningPlan({ focus, locale, generate: rec.generate, configured });
          const reached = r.attempts > 0;
          const firstErrors = reached ? (r.validation_errors[0] ?? []) : [];
          const text = [r.plan.summary, ...r.plan.priorities.flatMap((p) => [p.why, p.practice])].join(" ");
          let wrong: number | null = null;
          if (locale === "en" && r.status === "ready") {
            wrong = r.plan.priorities.filter((p) => {
              const t = `${p.why} ${p.practice}`.toLowerCase();
              const sev = RULES[p.rule].severity;
              return (sev === "minor" && /\bmajor\b/.test(t)) || (sev === "major" && /\bminor\b/.test(t));
            }).length;
          }
          return {
            set, locale, run, status: r.status, attempts: r.attempts,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, validation_errors: r.validation_errors,
            first_try_clean: firstTryClean(r, r.status),
            first_schema_ok: reached ? !firstErrors.some(isSchemaError) : null,
            first_invented_number: reached ? firstErrors.some(isInvented) : null,
            first_errors: firstErrors,
            first_raw: firstErrors.length ? (rec.outputs[0] ?? null) : null,
            covers_all: new Set(r.plan.priorities.map((p) => p.rule)).size === Math.min(focus.length, 5),
            top_matches_heaviest: r.status === "ready" ? r.plan.priorities[0]?.rule === focus[0]?.rule : null,
            language_ok: languageOk(text, locale),
            wrong_severity_claims: wrong,
          };
        });
  return pool(jobs);
}

// ---------- QUIZ GENERATION ----------
const QUIZ_SETS: Record<string, RuleKey[]> = {
  speed_stop_pedestrian: ["speeding", "stop_sign", "pedestrian_crossing"],
  light_wrongway_giveway: ["red_light", "wrong_way", "give_way"],
  collision_speeding: ["collision", "speeding"],
  all_rules: [...RULE_KEYS],
};

const normalize = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Compares the option marked correct with the catalog when the question is about a fine or a speed limit. */
function factCheck(rule: RuleKey, correct: string): boolean | null {
  const nums = (correct.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return null;
  if (/AZN/i.test(correct)) {
    const fine = RULES[rule].fineAzn;
    return fine === null ? null : nums.includes(fine);
  }
  if (/(km\/h|км\/ч|km\/saat|km\/s)/i.test(correct)) return nums.some((n) => (Object.values(SPEED_LIMITS) as number[]).includes(n));
  return null;
}

interface QuizRecord extends Usage {
  set: string;
  locale: Locale;
  run: number;
  status: string;
  first_try_clean: boolean;
  first_schema_ok: boolean | null;
  first_invented_number: boolean | null;
  first_errors: string[];
  first_raw: string | null;
  questions: { rule: RuleKey; correct_index: number; fact: boolean | null; duplicate_of_bank: boolean; language_ok: boolean }[];
}

async function evalQuiz(): Promise<QuizRecord[]> {
  const jobs: (() => Promise<QuizRecord>)[] = [];
  for (const [set, rules] of Object.entries(QUIZ_SETS))
    for (const locale of LOCALES)
      for (let run = 1; run <= RUNS; run++)
        jobs.push(async () => {
          const existing = bankQuestions(locale).map((q) => q.text);
          const rec = recorder();
          const r = await generateQuizQuestions({ rules, count: 3, locale, existing, generate: rec.generate, configured });
          const reached = r.attempts > 0;
          const firstErrors = reached ? (r.validation_errors[0] ?? []) : [];
          const bank = new Set(existing.map(normalize));
          return {
            set, locale, run, status: r.status, attempts: r.attempts,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, validation_errors: r.validation_errors,
            first_try_clean: firstTryClean(r, r.status),
            first_schema_ok: reached ? !firstErrors.some(isSchemaError) : null,
            first_invented_number: reached ? firstErrors.some(isInvented) : null,
            first_errors: firstErrors,
            first_raw: firstErrors.length ? (rec.outputs[0] ?? null) : null,
            questions: r.questions.map((q) => ({
              rule: q.rule,
              correct_index: q.correct_index,
              fact: factCheck(q.rule, q.options[q.correct_index]),
              duplicate_of_bank: bank.has(normalize(q.text)),
              language_ok: languageOk([q.text, ...q.options, q.explanation].join(" "), locale),
            })),
          };
        });
  return pool(jobs);
}

// ---------- CHAT ----------
interface ChatCase {
  id: string;
  mode: "free" | "exam";
  question: string;
  snapshot: Record<string, unknown>;
  expect: "answer" | "refused" | "directions";
  expectRules: boolean;
}

const baseSnapshot = { speed_kmh: 72, limit_kmh: 60, street: "Nizami küç.", next_sign: "STOP" };
const CHAT_CASES: ChatCase[] = [
  { id: "free_why_fine", mode: "free", question: "Why did I just get a fine?", snapshot: { ...baseSnapshot, mode: "free", recent_faults: [{ rule: "speeding", seconds_ago: 25 }] }, expect: "answer", expectRules: true },
  { id: "free_limit_here", mode: "free", question: "What is the speed limit in a living zone?", snapshot: { ...baseSnapshot, mode: "free", speed_kmh: 15, limit_kmh: 20, recent_faults: [] }, expect: "answer", expectRules: false },
  { id: "free_stop_sign", mode: "free", question: "What must I do at a STOP sign?", snapshot: { ...baseSnapshot, mode: "free", speed_kmh: 30, recent_faults: [] }, expect: "answer", expectRules: true },
  { id: "free_pedestrians", mode: "free", question: "Do I have to stop for pedestrians at a crossing?", snapshot: { ...baseSnapshot, mode: "free", recent_faults: [] }, expect: "answer", expectRules: true },
  { id: "free_one_way", mode: "free", question: "Can I drive against the direction of a one-way street?", snapshot: { ...baseSnapshot, mode: "free", recent_faults: [] }, expect: "answer", expectRules: true },
  { id: "free_off_topic", mode: "free", question: "What is a good pizza recipe?", snapshot: { ...baseSnapshot, mode: "free", recent_faults: [] }, expect: "answer", expectRules: false },
  { id: "exam_stop_rule", mode: "exam", question: "What should I do at the STOP sign?", snapshot: { ...baseSnapshot, mode: "exam", next_instruction: "Turn right in 120 m", recent_faults: [] }, expect: "refused", expectRules: false },
  { id: "exam_why_fine", mode: "exam", question: "Why did I get a fine?", snapshot: { ...baseSnapshot, mode: "exam", recent_faults: [{ rule: "speeding", seconds_ago: 20 }] }, expect: "refused", expectRules: false },
  { id: "exam_priority", mode: "exam", question: "Who has priority at this junction?", snapshot: { ...baseSnapshot, mode: "exam", next_instruction: "Go straight for 300 m", recent_faults: [] }, expect: "refused", expectRules: false },
  { id: "exam_speed_up", mode: "exam", question: "Can I speed up here?", snapshot: { ...baseSnapshot, mode: "exam", recent_faults: [] }, expect: "refused", expectRules: false },
  { id: "exam_where_now", mode: "exam", question: "Where do I go now?", snapshot: { ...baseSnapshot, mode: "exam", next_instruction: "Turn right in 120 m", recent_faults: [] }, expect: "directions", expectRules: false },
  { id: "exam_which_way", mode: "exam", question: "Which way should I turn next?", snapshot: { ...baseSnapshot, mode: "exam", next_instruction: "Go straight for 300 m", recent_faults: [] }, expect: "directions", expectRules: false },
];

interface ChatRecord extends Usage {
  case: string;
  mode: "free" | "exam";
  locale: Locale;
  expect: string;
  status: string;
  kind: string;
  rules: string[];
  kind_as_expected: boolean;
  guard_holds: boolean;
  rules_as_expected: boolean;
  language_ok: boolean;
  first_raw: string | null;
}

async function evalChat(): Promise<ChatRecord[]> {
  const jobs: (() => Promise<ChatRecord>)[] = [];
  for (const c of CHAT_CASES)
    for (const locale of LOCALES)
      jobs.push(async () => {
        const rec = recorder();
        const out = await answerDrivingQuestion({ body: { question: c.question, snapshot: c.snapshot }, locale, focus: [], generate: rec.generate, configured });
        if (!out.ok) throw new Error(`chat case ${c.id} rejected: ${out.issues.join("; ")}`);
        const r = out.result;
        const exam = c.mode === "exam";
        return {
          case: c.id, mode: c.mode, locale, expect: c.expect, status: r.status, kind: r.reply.kind, rules: r.reply.rules,
          attempts: r.attempts, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, validation_errors: r.validation_errors,
          kind_as_expected: r.reply.kind === c.expect,
          guard_holds: !exam || (r.reply.kind !== "answer" && r.reply.rules.length === 0),
          rules_as_expected: c.expectRules ? r.reply.rules.length > 0 : exam ? r.reply.rules.length === 0 : true,
          language_ok: languageOk(r.reply.answer, locale),
          first_raw: r.status === "ready" ? null : (rec.outputs[0] ?? null),
        };
      });
  return pool(jobs);
}

// ---------- EXAM BRIEF (deterministic) ----------
interface Check { name: string; passed: boolean; detail: string }

function evalBrief(): { checks: Check[]; quiz_weak_share: { set: string; mean_pct: number; min_pct: number; seeds: number }[] } {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const expectedOf = (n: string) => JSON.parse(readFileSync(`fixtures/${n}.expected.json`, "utf8")) as { top_issue_rule: string | null; must_raise_rules: string[] };

  for (const n of ["speeder", "red_light_runner", "mixed_exam_fail", "progress_series_1"]) {
    const exp = expectedOf(n);
    const focus = focusFromTelemetry([fx(n)]);
    const top = focus[0]?.rule ?? null;
    add(`${n}: heaviest weak spot is the expected top issue`, top === exp.top_issue_rule, `focus top ${top}, expected ${exp.top_issue_rule}`);
    const missing = exp.must_raise_rules.filter((r) => !focus.some((f) => f.rule === r));
    add(`${n}: every rule that must be raised is in the profile`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${exp.must_raise_rules.length} rules present`);
    const brief = buildExamBrief({ focus, drivesCount: 1 });
    add(`${n}: brief targets the top weak spots in order`, JSON.stringify(brief.focus_rules.map((r) => r.rule)) === JSON.stringify(focus.slice(0, 3).map((f) => f.rule)), `focus_rules ${brief.focus_rules.map((r) => r.rule).join(", ")}`);
  }
  for (const n of ["clean_drive", "nervous"]) {
    const focus = focusFromTelemetry([fx(n)]);
    const brief = buildExamBrief({ focus, drivesCount: 1 });
    add(`${n}: no weak spots and a harder exam`, focus.length === 0 && brief.reason === "clean" && brief.difficulty === "hard", `focus ${focus.length}, reason ${brief.reason}, difficulty ${brief.difficulty}`);
  }
  const none = buildExamBrief({ focus: [], drivesCount: 0 });
  add("new player: general standard exam", none.reason === "no_history" && none.difficulty === "standard" && none.focus_rules.length === 0, `${none.reason}/${none.difficulty}`);

  const s = ["progress_series_1", "progress_series_2", "progress_series_3"].map(fx);
  const failed = [...new Set(faultsFromTelemetry(s[0]).faults.map((f) => f.rule))];
  const weights = [1, 2, 3].map((k) => focusFromTelemetry(s.slice(0, k)));
  for (const rule of failed) {
    const w = weights.map((f) => f.find((x) => x.rule === rule)?.weight ?? 0);
    const counts = s.map((d) => faultsFromTelemetry(d).faults.filter((f) => f.rule === rule).length);
    const fewer = counts[1] <= counts[0] && counts[2] <= counts[1];
    add(`series: weight of ${rule} does not rise while its fault count falls`, !fewer || (w[1] <= w[0] && w[2] <= w[1]), `faults per drive ${counts.join(" → ")}, weights ${w.join(" → ")}`);
  }

  const brief1 = buildExamBrief({ focus: weights[0], drivesCount: 1 });
  const cleanExam = compareExamWithBrief({ brief: brief1, exam: faultsFromTelemetry(s[2]), nextFocus: weights[2] });
  add("clean exam after weak history: every focus rule improved", cleanExam.improved === brief1.focus_rules.length && cleanExam.worse === 0, `improved ${cleanExam.improved}/${brief1.focus_rules.length}, worse ${cleanExam.worse}`);
  const brief2 = buildExamBrief({ focus: focusFromTelemetry([s[2]]), drivesCount: 1 });
  const rlr = fx("red_light_runner");
  const repeat = compareExamWithBrief({ brief: buildExamBrief({ focus: focusFromTelemetry([rlr]), drivesCount: 1 }), exam: faultsFromTelemetry(rlr), nextFocus: focusFromTelemetry([rlr, rlr]) });
  add("same faults repeated in the exam: nothing is marked improved", repeat.improved === 0, `improved ${repeat.improved}, same ${repeat.same}, worse ${repeat.worse}`);
  add("clean history brief has no focus rules", brief2.focus_rules.length === 0, brief2.reason);

  const quiz_weak_share = Object.entries(PLAN_SETS)
    .map(([set, names]) => ({ set, focus: focusFromTelemetry(names.map(fx)) }))
    .filter((s2) => s2.focus.length > 0)
    .map(({ set, focus }) => {
      const seeds = 200;
      const shares = Array.from({ length: seeds }, (_, seed) => {
        const quiz = buildQuiz({ locale: "en", dictionary: en.quiz, focus: focus as FocusEntry[], seed: seed + 1 });
        const weak = new Set(focus.map((f) => f.rule));
        return (quiz.questions.filter((q) => weak.has(q.rule)).length / quiz.questions.length) * 100;
      });
      return { set, mean_pct: Math.round((shares.reduce((a, b) => a + b, 0) / seeds) * 10) / 10, min_pct: Math.round(Math.min(...shares)), seeds };
    });
  return { checks, quiz_weak_share };
}

// ---------- pricing ----------
async function fetchPrices(): Promise<{ input: number; output: number } | null> {
  const envIn = Number(process.env.OPENROUTER_PRICE_INPUT_PER_M);
  const envOut = Number(process.env.OPENROUTER_PRICE_OUTPUT_PER_M);
  if (Number.isFinite(envIn) && Number.isFinite(envOut)) return { input: envIn, output: envOut };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15000) });
    const data = (await res.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
    const m = data.data.find((x) => x.id === aiModel());
    return m ? { input: Number(m.pricing.prompt) * 1e6, output: Number(m.pricing.completion) * 1e6 } : null;
  } catch {
    return null;
  }
}

// ---------- aggregate ----------
function usageStats(rs: Usage[], prices: { input: number; output: number } | null) {
  const ok = rs.filter((r) => r.input_tokens !== null);
  const lat = ok.map((r) => r.latency_ms ?? 0);
  const cost = prices ? ok.map((r) => ((r.input_tokens ?? 0) * prices.input + (r.output_tokens ?? 0) * prices.output) / 1e6) : [];
  return {
    calls_with_usage: ok.length,
    latency_ms: { p50: quant(lat, 0.5), p95: quant(lat, 0.95), max: quant(lat, 1) },
    input_tokens_p50: quant(ok.map((r) => r.input_tokens ?? 0), 0.5),
    output_tokens_p50: quant(ok.map((r) => r.output_tokens ?? 0), 0.5),
    cost_usd: prices ? { p50: quant(cost, 0.5), max: quant(cost, 1), total: cost.reduce((a, b) => a + b, 0) } : null,
  };
}

function aggregate(plan: PlanRecord[], quiz: QuizRecord[], chat: ChatRecord[], prices: { input: number; output: number } | null) {
  const planReached = plan.filter((r) => r.first_schema_ok !== null);
  const planReady = plan.filter((r) => r.status === "ready");
  const planEn = planReady.filter((r) => r.wrong_severity_claims !== null);
  const quizReached = quiz.filter((r) => r.first_schema_ok !== null);
  const quizReady = quiz.filter((r) => r.status === "ready");
  const qs = quizReady.flatMap((r) => r.questions);
  const factual = qs.filter((q) => q.fact !== null);
  const dist = [0, 1, 2, 3].map((i) => qs.filter((q) => q.correct_index === i).length);
  const chatReached = chat.filter((r) => r.attempts > 0);
  const free = chat.filter((r) => r.mode === "free");
  const exam = chat.filter((r) => r.mode === "exam");
  const examReady = exam.filter((r) => r.status === "ready");
  return {
    plan: {
      runs: plan.length,
      accepted_pct: pct(planReady.length, plan.length),
      first_attempt_clean_pct: pct(plan.filter((r) => r.first_try_clean).length, plan.length),
      schema_validity_first_attempt_pct: pct(planReached.filter((r) => r.first_schema_ok).length, planReached.length),
      invented_number_first_attempt_pct: pct(planReached.filter((r) => r.first_invented_number).length, planReached.length),
      covers_every_weak_rule_pct: pct(planReady.filter((r) => r.covers_all).length, planReady.length),
      heaviest_rule_first_pct: pct(planReady.filter((r) => r.top_matches_heaviest).length, planReady.length),
      wrong_severity_claims: { plans_checked: planEn.length, claims: planEn.reduce((n, r) => n + (r.wrong_severity_claims ?? 0), 0) },
      language_ok_pct: pct(planReady.filter((r) => r.language_ok).length, planReady.length),
      fallback_pct: pct(plan.length - planReady.length, plan.length),
      ...usageStats(plan, prices),
    },
    quiz: {
      calls: quiz.length,
      accepted_pct: pct(quizReady.length, quiz.length),
      first_attempt_clean_pct: pct(quiz.filter((r) => r.first_try_clean).length, quiz.length),
      schema_validity_first_attempt_pct: pct(quizReached.filter((r) => r.first_schema_ok).length, quizReached.length),
      invented_number_first_attempt_pct: pct(quizReached.filter((r) => r.first_invented_number).length, quizReached.length),
      questions: qs.length,
      fact_checkable: factual.length,
      fact_check_pass_pct: pct(factual.filter((q) => q.fact).length, factual.length),
      wrong_answer_rate_pct: pct(factual.filter((q) => !q.fact).length, factual.length),
      duplicates_of_bank: qs.filter((q) => q.duplicate_of_bank).length,
      correct_index_distribution: dist,
      language_ok_pct: pct(qs.filter((q) => q.language_ok).length, qs.length),
      fallback_pct: pct(quiz.length - quizReady.length, quiz.length),
      ...usageStats(quiz, prices),
    },
    chat: {
      replies: chat.length,
      free: {
        n: free.length,
        model_answer_pct: pct(free.filter((r) => r.status === "ready").length, free.length),
        kind_as_expected_pct: pct(free.filter((r) => r.kind_as_expected).length, free.length),
        rules_cited_when_expected_pct: pct(free.filter((r) => r.rules_as_expected).length, free.length),
        language_ok_pct: pct(free.filter((r) => r.language_ok).length, free.length),
      },
      exam: {
        n: exam.length,
        guard_holds_pct: pct(exam.filter((r) => r.guard_holds).length, exam.length),
        model_complied_first_try_pct: pct(examReady.length, exam.length),
        right_kind_pct: pct(exam.filter((r) => r.kind_as_expected).length, exam.length),
        refused_when_asked_for_rules_pct: pct(exam.filter((r) => r.expect === "refused" && r.kind === "refused").length, exam.filter((r) => r.expect === "refused").length),
        directions_when_available_pct: pct(exam.filter((r) => r.expect === "directions" && r.kind === "directions").length, exam.filter((r) => r.expect === "directions").length),
        language_ok_pct: pct(exam.filter((r) => r.language_ok).length, exam.length),
      },
      fallback_pct: pct(chat.length - chat.filter((r) => r.status === "ready").length, chat.length),
      reached_model: chatReached.length,
      ...usageStats(chat, prices),
    },
  };
}

// ---------- markdown ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMarkdown(r: any): string {
  const v = (x: unknown, suffix = "") => (x === null || x === undefined ? "n/a" : `${x}${suffix}`);
  const usd = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `$${x.toFixed(5)}`);
  const L: string[] = [];
  const m = r.measures;
  L.push(`# Roadwise — learning loop and instructor chat evaluation`);
  L.push("");
  L.push(`Generated by \`npm run eval:learning\` on ${r.generated_at} · model \`${r.model ?? "none"}\` · prompts plan \`${r.prompt_versions.plan}\`, quiz \`${r.prompt_versions.quiz}\`, chat \`${r.prompt_versions.chat}\` · ${r.config.runs} runs × ${r.config.locales.join("/")}. Every number below comes from this run (\`eval/learning-report.json\`).`);
  L.push("");
  if (r.sections.includes("plan") || r.sections.includes("quiz") || r.sections.includes("chat")) {
    const accepted = [m.plan?.accepted_pct, m.quiz?.accepted_pct].filter((x) => x !== null && x !== undefined);
    if (accepted.length && accepted.every((x: number) => x === 0)) {
      L.push(`> **No model answer was accepted in this run** — the model was not reachable or every answer was rejected. Model measures below are \`n/a\`; see the failure examples.`);
      L.push("");
    }
  }
  if (m.plan) {
    const p = m.plan;
    L.push(`## Practice plan (${p.runs} generations)`);
    L.push("");
    L.push(`Six weakness profiles built from the fixtures (single drives, a three-drive improving series, a major-fault exam) × languages × runs.`);
    L.push("");
    L.push(`| Measure | Value | Definition |`);
    L.push(`|---|---|---|`);
    L.push(`| Accepted by the validator | ${v(p.accepted_pct, "%")} | final plan came from the model, not the fallback |`);
    L.push(`| **First attempt clean** | **${v(p.first_attempt_clean_pct, "%")}** | accepted without a retry |`);
    L.push(`| Schema validity (first attempt) | ${v(p.schema_validity_first_attempt_pct, "%")} | valid JSON in the plan schema |`);
    L.push(`| Invented numbers (first attempt) | ${v(p.invented_number_first_attempt_pct, "%")} | answers containing a number not in the input |`);
    L.push(`| Every weak rule covered | ${v(p.covers_every_weak_rule_pct, "%")} | each rule from the profile appears exactly once |`);
    L.push(`| Heaviest weak spot first | ${v(p.heaviest_rule_first_pct, "%")} | model's priority #1 equals the profile's top rule |`);
    L.push(`| Wrong severity claims (EN) | ${p.wrong_severity_claims.claims} in ${p.wrong_severity_claims.plans_checked} plans | text calls a minor fault major or the reverse |`);
    L.push(`| Language check | ${v(p.language_ok_pct, "%")} | script matches the locale |`);
    L.push(`| **Fallback rate** | **${v(p.fallback_pct, "%")}** | plans that ended in the standard tips |`);
    L.push(`| Latency | p50 ${v(p.latency_ms.p50, " ms")} · p95 ${v(p.latency_ms.p95, " ms")} · max ${v(p.latency_ms.max, " ms")} | sum over attempts |`);
    L.push(`| Tokens | in p50 ${v(p.input_tokens_p50)} · out p50 ${v(p.output_tokens_p50)} | output includes thinking tokens |`);
    L.push(`| **Cost per plan** | p50 ${usd(p.cost_usd?.p50)} · max ${usd(p.cost_usd?.max)} | tokens × OpenRouter price |`);
    L.push("");
  }
  if (m.quiz) {
    const q = m.quiz;
    L.push(`## Generated quiz questions (${q.calls} calls × 3 questions)`);
    L.push("");
    L.push(`| Measure | Value | Definition |`);
    L.push(`|---|---|---|`);
    L.push(`| Accepted by the validator | ${v(q.accepted_pct, "%")} | |`);
    L.push(`| **First attempt clean** | **${v(q.first_attempt_clean_pct, "%")}** | accepted without a retry |`);
    L.push(`| Schema validity (first attempt) | ${v(q.schema_validity_first_attempt_pct, "%")} | |`);
    L.push(`| Invented numbers (first attempt) | ${v(q.invented_number_first_attempt_pct, "%")} | |`);
    L.push(`| Questions accepted | ${q.questions} | |`);
    L.push(`| **Wrong-answer rate** | **${v(q.wrong_answer_rate_pct, "%")}** | of ${q.fact_checkable} questions whose correct option is a fine or a speed limit, how many contradict the rule catalog |`);
    L.push(`| Fact-check pass | ${v(q.fact_check_pass_pct, "%")} | the same set, correct option matches the catalog |`);
    L.push(`| Copies of bank questions | ${q.duplicates_of_bank} | generated question identical to a bank question |`);
    L.push(`| Correct-answer position | [${q.correct_index_distribution.join(", ")}] for options 1–4 | bias check, before the builder shuffles options |`);
    L.push(`| Language check | ${v(q.language_ok_pct, "%")} | |`);
    L.push(`| **Fallback rate** | **${v(q.fallback_pct, "%")}** | calls that produced no model questions (the bank and templates still make a full quiz) |`);
    L.push(`| Latency | p50 ${v(q.latency_ms.p50, " ms")} · p95 ${v(q.latency_ms.p95, " ms")} · max ${v(q.latency_ms.max, " ms")} | |`);
    L.push(`| **Cost per call (3 questions)** | p50 ${usd(q.cost_usd?.p50)} · max ${usd(q.cost_usd?.max)} | |`);
    L.push("");
  }
  if (m.chat) {
    const c = m.chat;
    L.push(`## Instructor chat (${c.replies} replies, one attempt each)`);
    L.push("");
    L.push(`| Measure | Value | Definition |`);
    L.push(`|---|---|---|`);
    L.push(`| Free drive: model answer used | ${v(c.free.model_answer_pct, "%")} | passed the checks on the single attempt (n=${c.free.n}) |`);
    L.push(`| Free drive: right kind | ${v(c.free.kind_as_expected_pct, "%")} | |`);
    L.push(`| Free drive: rules cited when expected | ${v(c.free.rules_cited_when_expected_pct, "%")} | rule questions list at least one rule key |`);
    L.push(`| Free drive: language | ${v(c.free.language_ok_pct, "%")} | |`);
    L.push(`| **Exam guard holds** | **${v(c.exam.guard_holds_pct, "%")}** | no rule explanation or rule key reaches the player in an exam (n=${c.exam.n}) |`);
    L.push(`| Exam: model complied on its own | ${v(c.exam.model_complied_first_try_pct, "%")} | the model's own answer was accepted, without the canned refusal |`);
    L.push(`| Exam: refused when asked about rules | ${v(c.exam.refused_when_asked_for_rules_pct, "%")} | |`);
    L.push(`| Exam: gave directions when the game sent them | ${v(c.exam.directions_when_available_pct, "%")} | |`);
    L.push(`| Exam: language | ${v(c.exam.language_ok_pct, "%")} | |`);
    L.push(`| **Fallback rate** | **${v(c.fallback_pct, "%")}** | canned answers used |`);
    L.push(`| **Latency** | p50 ${v(c.latency_ms.p50, " ms")} · p95 ${v(c.latency_ms.p95, " ms")} · max ${v(c.latency_ms.max, " ms")} | a driver waits for this |`);
    L.push(`| Tokens | in p50 ${v(c.input_tokens_p50)} · out p50 ${v(c.output_tokens_p50)} | |`);
    L.push(`| **Cost per question** | p50 ${usd(c.cost_usd?.p50)} · max ${usd(c.cost_usd?.max)} | |`);
    L.push("");
  }
  if (r.brief) {
    const passed = r.brief.checks.filter((x: Check) => x.passed).length;
    L.push(`## Exam brief and profile correctness (no model)`);
    L.push("");
    L.push(`**${passed}/${r.brief.checks.length} checks pass**, computed from the fixtures and their \`*.expected.json\` files.`);
    L.push("");
    L.push(`| Check | Result | Detail |`);
    L.push(`|---|---|---|`);
    for (const x of r.brief.checks) L.push(`| ${x.name} | ${x.passed ? "pass" : "**FAIL**"} | ${x.detail} |`);
    L.push("");
    L.push(`Quiz builder, weak-rule share (target ≥ 70% when the player has weak spots; ${r.brief.quiz_weak_share[0]?.seeds ?? 0} seeds per profile):`);
    L.push("");
    L.push(`| Profile | Mean weak-rule share | Worst quiz |`);
    L.push(`|---|---|---|`);
    for (const s of r.brief.quiz_weak_share) L.push(`| ${s.set} | ${s.mean_pct}% | ${s.min_pct}% |`);
    L.push("");
  }
  L.push(`## Failure examples (first attempts the validators rejected)`);
  L.push("");
  if (r.failure_examples.length === 0) L.push(`No first attempt was rejected in this run.`);
  for (const f of r.failure_examples) {
    L.push(`### ${f.feature} · ${f.case} · ${f.locale} → ${f.final_status}`);
    L.push("");
    L.push(`Validator reasons: ${f.reasons.join("; ")}`);
    L.push("");
    if (f.rejected_output) {
      L.push("Rejected model output (truncated):");
      L.push("```json");
      L.push(String(f.rejected_output).slice(0, 1400));
      L.push("```");
    }
    L.push("");
  }
  L.push("");
  L.push(`## Notes`);
  L.push("");
  L.push(`- The model only writes wording; weights, plans' rule lists, quiz answers' scoring, briefs and comparisons are computed by code, and every model answer passes a grounding validator before it is shown.`);
  L.push(`- The fact check covers only questions whose correct option is a fine in AZN or a speed limit; situation questions are validated for structure, not for truth.`);
  L.push(`- Fixtures are synthetic. RU and AZ outputs are provisional and need a native check.`);
  L.push("");
  return L.join("\n");
}

async function main() {
  const started = new Date();
  const prices = FAKE ? null : await fetchPrices();
  console.log(`eval:learning · sections ${SECTIONS.join(",")} · ${RUNS} runs × ${LOCALES.join("/")} · model ${FAKE ? "fake-llm" : process.env.OPENROUTER_API_KEY ? aiModel() : "none (OPENROUTER_API_KEY unset)"}`);

  const plan = SECTIONS.includes("plan") ? await evalPlan() : [];
  const quiz = SECTIONS.includes("quiz") ? await evalQuiz() : [];
  const chat = SECTIONS.includes("chat") ? await evalChat() : [];
  process.stdout.write("\n");
  const brief = SECTIONS.includes("brief") ? evalBrief() : null;

  const measures = aggregate(plan, quiz, chat, prices);
  const failure_examples = [
    ...plan.filter((r) => r.first_errors.length).map((r) => ({ feature: "plan", case: r.set, locale: r.locale, reasons: r.first_errors, final_status: r.status, rejected_output: r.first_raw })),
    ...quiz.filter((r) => r.first_errors.length).map((r) => ({ feature: "quiz", case: r.set, locale: r.locale, reasons: r.first_errors, final_status: r.status, rejected_output: r.first_raw })),
    ...chat.filter((r) => r.status !== "ready" && r.validation_errors.length).map((r) => ({ feature: "chat", case: r.case, locale: r.locale, reasons: r.validation_errors[0] ?? [], final_status: r.status, rejected_output: r.first_raw })),
  ].slice(0, 4);

  const report = {
    generated_at: started.toISOString(),
    model: FAKE ? "fake-llm" : process.env.OPENROUTER_API_KEY ? aiModel() : null,
    prompt_versions: { plan: "plan-1", quiz: "quiz-1", chat: "chat-1" },
    config: { runs: RUNS, locales: LOCALES, sections: SECTIONS },
    sections: SECTIONS,
    prices_per_m: prices,
    measures: { plan: plan.length ? measures.plan : null, quiz: quiz.length ? measures.quiz : null, chat: chat.length ? measures.chat : null },
    brief,
    failure_examples,
    records: { plan, quiz, chat },
  };
  writeFileSync(path.join(OUT, "learning-report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(OUT, "LEARNING_REPORT.md"), renderMarkdown(report));
  const total = [measures.plan.cost_usd, measures.quiz.cost_usd, measures.chat.cost_usd].reduce((a, c) => a + (c?.total ?? 0), 0);
  console.log(`wrote ${OUT}/learning-report.json and ${OUT}/LEARNING_REPORT.md (plan ${plan.length}, quiz ${quiz.length}, chat ${chat.length} · model cost $${total.toFixed(4)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
