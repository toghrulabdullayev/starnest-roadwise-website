/** Runs the plan, quiz generation and chat prompts against the real model.  npm run ai:live -- [en|ru|az] */
import "./env";
import { readFileSync } from "node:fs";
import { generateQuizQuestions } from "../lib/ai/quiz/generator";
import { generateLearningPlan } from "../lib/ai/plan/planner";
import { answerDrivingQuestion } from "../lib/ai/chat/responder";
import { isLocale, type Locale } from "../lib/i18n/config";
import { focusFromTelemetry } from "../lib/profile/focus";
import { parseTelemetry } from "../lib/telemetry/schema";

const arg = process.argv[2] ?? "en";
if (!isLocale(arg)) throw new Error("locale must be en, ru or az");
const locale: Locale = arg;

const load = (name: string) => {
  const parsed = parseTelemetry(JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8")));
  if (!parsed.ok) throw new Error(name);
  return parsed.data;
};

const usage = (r: { status: string; model: string | null; attempts: number; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; validation_errors: string[][] }) =>
  `status=${r.status} model=${r.model} attempts=${r.attempts} tokens=${r.input_tokens}/${r.output_tokens} latency=${r.latency_ms}ms` +
  (r.validation_errors.length ? `\n  validation: ${JSON.stringify(r.validation_errors).slice(0, 600)}` : "");

(async () => {
  const focus = focusFromTelemetry([load("progress_series_1"), load("progress_series_2")]);

  console.log(`\n=== PLAN (${locale}) ===`);
  const plan = await generateLearningPlan({ focus, locale });
  console.log(usage(plan));
  console.log(JSON.stringify(plan.plan, null, 2));

  console.log(`\n=== QUIZ questions (${locale}) ===`);
  const quiz = await generateQuizQuestions({ rules: focus.slice(0, 3).map((f) => f.rule), count: 3, locale });
  console.log(usage(quiz));
  console.log(JSON.stringify(quiz.questions, null, 2));

  const snapshot = {
    mode: "free",
    speed_kmh: 72,
    limit_kmh: 60,
    street: "Nizami küç.",
    next_sign: "STOP",
    recent_faults: [{ rule: "speeding", seconds_ago: 25 }],
  };
  for (const [label, body] of [
    ["CHAT free", { question: "Why did I just get a fine?", snapshot }],
    ["CHAT exam", { question: "What should I do at the STOP sign?", snapshot: { ...snapshot, mode: "exam", next_instruction: "Turn right in 120 m", recent_faults: [] } }],
  ] as const) {
    console.log(`\n=== ${label} (${locale}) ===`);
    const out = await answerDrivingQuestion({ body, locale, focus });
    if (!out.ok) console.log(out.issues);
    else {
      console.log(usage(out.result));
      console.log(JSON.stringify(out.result.reply, null, 2));
    }
  }
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
