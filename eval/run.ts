/**
 * Roadwise evaluation harness (roadwise-ai-instructor §7).
 *   npm run eval                        all cases × 3 runs × en/ru/az
 *   npm run eval -- --runs 1 --locales en --cases red_light_runner
 * Writes eval/report.json and eval/REPORT.md from this run only — no hand-written numbers.
 *
 * Cost: tokens are logged per call; prices are read from GEMINI_PRICE_INPUT_PER_M / GEMINI_PRICE_OUTPUT_PER_M
 * (USD per 1M tokens, copy them from the current Gemini pricing page). Without them cost is reported as "not set".
 */
import "../scripts/env";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { computeMetrics, type DriveMetrics } from "../lib/metrics";
import { computeReadiness } from "../lib/readiness";
import { computeHistory } from "../lib/history";
import { parseTelemetry, type DriveTelemetry } from "../lib/telemetry/schema";
import { buildDebriefInput, type DebriefInput } from "../lib/instructor/input";
import { validateDebrief, type GroundingCheck } from "../lib/instructor/grounding";
import { buildFallbackDebrief } from "../lib/instructor/fallback";
import { runDebriefPipeline, type PipelineResult } from "../lib/instructor/pipeline";
import { createGeminiClient, type LlmClient } from "../lib/instructor/llm";
import { PROMPT_VERSION, type Debrief } from "../lib/prompts/debrief";
import { locales as ALL_LOCALES, type Locale } from "../lib/i18n/config";
import { RULES } from "../lib/rules/catalog";

// ---------- args ----------
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const RUNS = Number(arg("runs") ?? 3);
const LOCALES = (arg("locales")?.split(",") ?? [...ALL_LOCALES]) as Locale[];
const ONLY = arg("cases")?.split(",");
const OUT = arg("out") ?? "eval";
/** --fake-llm: harness self-test without the network (never used for the real report). */
const FAKE = process.argv.includes("--fake-llm");

// ---------- cases ----------
interface Expected {
  major_event_ids: string[];
  must_raise_rules: string[];
  top_issue_rule: string | null;
  readiness_band: string;
}
interface Case {
  name: string;
  source: "fixture" | "real";
  telemetry: DriveTelemetry;
  previous: DriveMetrics[]; // latest first
  expected: Expected | null;
}

const fx = (n: string): DriveTelemetry => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(`fixture ${n} invalid`);
  return r.data;
};
const exp = (n: string): Expected => JSON.parse(readFileSync(`fixtures/${n}.expected.json`, "utf8"));
const PREVIOUS: Record<string, string[]> = {
  progress_series_2: ["progress_series_1"],
  progress_series_3: ["progress_series_2", "progress_series_1"],
};

function loadCases(): Case[] {
  const names = ["clean_drive", "speeder", "red_light_runner", "nervous", "mixed_exam_fail", "progress_series_1", "progress_series_2", "progress_series_3"];
  const cases: Case[] = names.map((name) => ({
    name,
    source: "fixture",
    telemetry: fx(name),
    previous: (PREVIOUS[name] ?? []).map((p) => computeMetrics(fx(p))),
    expected: exp(name),
  }));
  const realDir = path.join("eval", "real");
  if (existsSync(realDir))
    for (const f of readdirSync(realDir).filter((f) => f.endsWith(".json"))) {
      const r = parseTelemetry(JSON.parse(readFileSync(path.join(realDir, f), "utf8")));
      if (!r.ok) {
        console.warn(`skipping eval/real/${f}: invalid`);
        continue;
      }
      cases.push({ name: `real:${f.replace(".json", "")}`, source: "real", telemetry: r.data, previous: [], expected: null });
    }
  return ONLY ? cases.filter((c) => ONLY.includes(c.name)) : cases;
}

function inputFor(c: Case, locale: Locale, withHistory = true): DebriefInput {
  const metrics = computeMetrics(c.telemetry);
  return buildDebriefInput({
    telemetry: c.telemetry,
    metrics,
    readiness: computeReadiness([metrics, ...c.previous]),
    history: computeHistory(metrics, c.previous),
    locale,
    withHistory,
  });
}

// ---------- measures ----------
function majorRecall(d: Debrief, input: DebriefInput): { covered: number; total: number } {
  const majors = input.events.filter((e) => e.outcome === "fail" && e.severity === "major").map((e) => e.id);
  const cited = new Set(d.issues.flatMap((i) => i.event_ids));
  return { covered: majors.filter((id) => cited.has(id)).length, total: majors.length };
}

/** Issue #1 is the most severe fault: matches the expected top rule (or is major when any major exists). */
function prioritised(d: Debrief, input: DebriefInput, expected: Expected | null): boolean | null {
  const hasFaults = input.events.some((e) => e.outcome === "fail");
  if (!hasFaults) return null;
  const first = d.issues[0];
  if (!first) return false;
  if (expected?.top_issue_rule) return first.rule === expected.top_issue_rule;
  const anyMajor = input.events.some((e) => e.outcome === "fail" && e.severity === "major");
  return anyMajor ? first.severity === "major" : true;
}

function languageOk(d: Debrief, locale: Locale, input: DebriefInput): boolean {
  let text = [d.summary, ...d.issues.flatMap((i) => [i.title, i.why_it_matters, i.how_to_fix]), d.next_drive.focus].join(" ");
  // street names are Azerbaijani proper nouns in every language; ignore them
  for (const street of new Set(input.events.map((e) => e.street).filter((x): x is string => !!x))) text = text.split(street).join(" ");
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyr = letters.filter((ch) => /\p{Script=Cyrillic}/u.test(ch)).length / Math.max(1, letters.length);
  const azMarks = /[əğıƏĞİ]/.test(text);
  if (locale === "ru") return cyr > 0.6;
  if (locale === "az") return cyr < 0.1 && azMarks;
  return cyr < 0.05 && !/[əğı]/.test(text);
}

function actionable(d: Debrief): number {
  return d.issues.filter((i) => i.how_to_fix.trim()).length + d.next_drive.drills.length;
}
function crossDrive(d: Debrief): number {
  return d.progress ? d.progress.improved.length + d.progress.worse.length : 0;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const quant = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

// ---------- run ----------
interface RunRecord {
  case: string;
  locale: Locale;
  run: number;
  with_history: boolean;
  status: PipelineResult["status"];
  api_error: string | null;
  first_schema_valid: boolean | null;
  first_grounded: boolean | null;
  first_errors: { check: GroundingCheck; message: string }[];
  attempts: number;
  recall: { covered: number; total: number };
  prioritised: boolean | null;
  top_rule: string | null;
  language_ok: boolean;
  actionable: number;
  cross_drive: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  attempt_log: PipelineResult["attempt_log"];
}

async function main() {
  const started = new Date();
  const client = FAKE ? fakeClient() : createGeminiClient();
  const cases = loadCases();
  console.log(`eval: ${cases.length} cases × ${RUNS} runs × ${LOCALES.join("/")} · model ${client?.model ?? "none (GEMINI_API_KEY unset)"} · ${PROMPT_VERSION}`);

  const records: RunRecord[] = [];
  const record = async (c: Case, locale: Locale, run: number, withHistory: boolean) => {
    const input = inputFor(c, locale, withHistory);
    const r = await runDebriefPipeline(input, locale, client);
    const first = r.attempt_log[0];
    const apiError = r.validation_errors.find((e) => e.includes("[api_error]")) ?? (client ? null : "GEMINI_API_KEY not configured");
    const firstReached = !!first && !apiError;
    const rec = majorRecall(r.debrief, input);
    records.push({
      case: c.name,
      locale,
      run,
      with_history: withHistory,
      status: r.status,
      api_error: apiError,
      first_schema_valid: firstReached ? !first.errors.some((e) => e.check === "schema") : null,
      first_grounded: firstReached ? first.ok : null,
      first_errors: firstReached ? first.errors : [],
      attempts: r.attempts,
      recall: rec,
      prioritised: prioritised(r.debrief, input, c.expected),
      top_rule: r.debrief.issues[0]?.rule ?? null,
      language_ok: languageOk(r.debrief, locale, input),
      actionable: actionable(r.debrief),
      cross_drive: crossDrive(r.debrief),
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      latency_ms: r.latency_ms,
      attempt_log: r.attempt_log,
    });
    process.stdout.write(r.status === "ready" ? "." : "f");
  };

  for (const c of cases) for (const locale of LOCALES) for (let run = 1; run <= RUNS; run++) await record(c, locale, run, true);
  // with vs without history: cases that have previous drives, English
  const historyCases = cases.filter((c) => c.previous.length > 0);
  for (const c of historyCases) for (let run = 1; run <= RUNS; run++) await record(c, "en", run, false);
  process.stdout.write("\n");

  // ---------- aggregate ----------
  const main = records.filter((r) => r.with_history);
  const ai = main.filter((r) => r.status === "ready");
  const reached = main.filter((r) => r.first_grounded !== null);
  const sumRecall = (rs: RunRecord[]) => rs.reduce((a, r) => ({ covered: a.covered + r.recall.covered, total: a.total + r.recall.total }), { covered: 0, total: 0 });
  const prio = (rs: RunRecord[]) => rs.filter((r) => r.prioritised !== null);
  const hall = { unknown_event: 0, unknown_rule: 0, invented_number: 0 };
  for (const r of reached) for (const e of r.first_errors) if (e.check in hall) hall[e.check as keyof typeof hall]++;

  // consistency: same top issue across the runs of a (case, locale)
  const groups = new Map<string, RunRecord[]>();
  for (const r of ai) groups.set(`${r.case}|${r.locale}`, [...(groups.get(`${r.case}|${r.locale}`) ?? []), r]);
  const multi = [...groups.values()].filter((g) => g.length > 1);
  const consistent = multi.filter((g) => new Set(g.map((r) => r.top_rule)).size === 1).length;

  const calls = records.flatMap((r) => r.attempt_log.filter((a) => a.input_tokens > 0));
  const perDebrief = ai.map((r) => ({ in: r.input_tokens, out: r.output_tokens, ms: r.latency_ms }));
  const priceIn = Number(process.env.GEMINI_PRICE_INPUT_PER_M || NaN);
  const priceOut = Number(process.env.GEMINI_PRICE_OUTPUT_PER_M || NaN);
  const pricesSet = Number.isFinite(priceIn) && Number.isFinite(priceOut);
  const costs = perDebrief.map((d) => (d.in * priceIn + d.out * priceOut) / 1e6);

  // baseline / fallback / AI side by side (English, run 1, with history)
  const comparison = cases.map((c) => {
    const input = inputFor(c, "en");
    const fallback = buildFallbackDebrief(input, "en");
    const aiRec = ai.find((r) => r.case === c.name && r.locale === "en");
    const fails = input.events.filter((e) => e.outcome === "fail");
    return {
      case: c.name,
      faults: fails.length,
      baseline: { actionable: 0, cross_drive: 0, prioritised: fails.length ? false : null, lines: fails.map((e) => `${RULES[e.rule].names.en} — ${e.fine_azn ?? 0} AZN`) },
      fallback: { actionable: actionable(fallback), cross_drive: crossDrive(fallback), prioritised: prioritised(fallback, input, c.expected), grounded: validateDebrief(JSON.stringify(fallback), input).ok },
      ai: aiRec ? { actionable: aiRec.actionable, cross_drive: aiRec.cross_drive, prioritised: aiRec.prioritised } : null,
    };
  });

  const histCompare = historyCases.map((c) => {
    const w = ai.filter((r) => r.case === c.name && r.locale === "en" && r.with_history);
    const wo = records.filter((r) => r.case === c.name && !r.with_history && r.status === "ready");
    const avg = (rs: RunRecord[], f: (r: RunRecord) => number) => (rs.length ? Math.round((rs.reduce((a, r) => a + f(r), 0) / rs.length) * 10) / 10 : null);
    const fbWith = buildFallbackDebrief(inputFor(c, "en", true), "en");
    const fbWithout = buildFallbackDebrief(inputFor(c, "en", false), "en");
    return {
      case: c.name,
      previous_drives: c.previous.length,
      ai_with: { runs: w.length, cross_drive: avg(w, (r) => r.cross_drive), actionable: avg(w, (r) => r.actionable) },
      ai_without: { runs: wo.length, cross_drive: avg(wo, (r) => r.cross_drive), actionable: avg(wo, (r) => r.actionable) },
      fallback_with: { cross_drive: crossDrive(fbWith) },
      fallback_without: { cross_drive: crossDrive(fbWithout) },
    };
  });

  // failure examples: first attempts the validator rejected, with what happened next
  const failures = records
    .filter((r) => r.attempt_log[0] && !r.attempt_log[0].ok && r.attempt_log[0].errors.length)
    .slice(0, 3)
    .map((r) => ({
      case: r.case,
      locale: r.locale,
      reasons: r.attempt_log[0].errors.map((e) => `[${e.check}] ${e.message}`),
      rejected_output: r.attempt_log[0].raw.slice(0, 1500),
      retry: r.attempt_log[1] ? { ok: r.attempt_log[1].ok, reasons: r.attempt_log[1].errors.map((e) => `[${e.check}] ${e.message}`), output: r.attempt_log[1].raw.slice(0, 1500) } : null,
      final_status: r.status,
    }));

  const fallbackRecall = sumRecall(main.filter((r) => r.status === "fallback"));
  const tests = runUnitTests();
  const report = {
    generated_at: started.toISOString(),
    prompt_version: PROMPT_VERSION,
    model: client?.model ?? null,
    config: { runs: RUNS, locales: LOCALES, cases: cases.map((c) => c.name) },
    unit_tests: tests,
    ai_available: ai.length > 0,
    api_errors: [...new Set(main.map((r) => r.api_error).filter(Boolean))],
    totals: { pipeline_runs: main.length, ai_ready: ai.length, fallback: main.length - ai.length, model_calls: calls.length },
    measures: {
      schema_validity_first_attempt_pct: pct(reached.filter((r) => r.first_schema_valid).length, reached.length),
      grounding_rate_first_attempt_pct: pct(reached.filter((r) => r.first_grounded).length, reached.length),
      hallucinated_references_first_attempt: hall,
      major_fault_recall_ai_pct: pct(sumRecall(ai).covered, sumRecall(ai).total),
      major_fault_recall_fallback_pct: pct(fallbackRecall.covered, fallbackRecall.total),
      prioritisation_ai_pct: pct(prio(ai).filter((r) => r.prioritised).length, prio(ai).length),
      consistency_top_issue_pct: pct(consistent, multi.length),
      fallback_rate_pct: pct(main.length - ai.length, main.length),
      language_check_ai_pct: pct(ai.filter((r) => r.language_ok).length, ai.length),
      language_check_all_pct: pct(main.filter((r) => r.language_ok).length, main.length),
      latency_ms: { p50: quant(perDebrief.map((d) => d.ms), 0.5), max: quant(perDebrief.map((d) => d.ms), 1) },
      input_tokens: { p50: quant(perDebrief.map((d) => d.in), 0.5), max: quant(perDebrief.map((d) => d.in), 1) },
      output_tokens: { p50: quant(perDebrief.map((d) => d.out), 0.5), max: quant(perDebrief.map((d) => d.out), 1) },
      cost_usd_per_debrief: pricesSet ? { p50: quant(costs, 0.5), max: quant(costs, 1), price_in_per_m: priceIn, price_out_per_m: priceOut } : "prices not set",
    },
    comparison,
    history_comparison: histCompare,
    failure_examples: failures,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- raw output is kept only in failure_examples
    records: records.map(({ attempt_log, ...r }) => ({ ...r, attempts_detail: attempt_log.map(({ raw, ...a }) => a) })),
  };
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(OUT, "REPORT.md"), renderMarkdown(report));
  console.log(`wrote ${OUT}/report.json and ${OUT}/REPORT.md (${main.length} runs, ${ai.length} AI-ready, fallback ${report.measures.fallback_rate_pct}%)`);
}

const TEST_OUT = path.join(tmpdir(), `roadwise-vitest-${process.pid}.json`);

/** Fake model: echoes the template debrief, and on every 3rd call first invents a number (exercises retry + failure examples). */
function fakeClient(): LlmClient {
  let n = 0;
  return {
    model: "fake-llm",
    async generate({ system, input }) {
      n++;
      const locale = (["en", "ru", "az"] as const).find((l) => system.includes(`Write all text in ${{ en: "English", ru: "Russian", az: "Azerbaijani" }[l]}`)) ?? "en";
      const data = JSON.parse(input.split("\n\n")[1]) as DebriefInput;
      const d = buildFallbackDebrief(data, locale);
      const retry = input.includes("previous answer was rejected");
      if (n % 3 === 0 && !retry) d.summary += " You reached 137 km/h.";
      return { text: JSON.stringify(d), model: "fake-llm", input_tokens: 1800 + (n % 7) * 10, output_tokens: 600, latency_ms: 5 };
    },
  };
}

function runUnitTests() {
  try {
    execSync(`npx vitest run --reporter=json --outputFile=${TEST_OUT}`, { stdio: "ignore" });
  } catch {
    /* failing tests still write the file */
  }
  try {
    const j = JSON.parse(readFileSync(TEST_OUT, "utf8"));
    return { files: j.numTotalTestSuites, tests: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests };
  } catch {
    return { error: "could not run vitest" };
  }
}

// ---------- markdown ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMarkdown(r: any): string {
  const m = r.measures;
  const v = (x: unknown, suffix = "") => (x === null || x === undefined ? "n/a" : `${x}${suffix}`);
  const L: string[] = [];
  L.push(`# Roadwise — AI instructor evaluation`);
  L.push("");
  L.push(`Generated by \`npm run eval\` on ${r.generated_at} · prompt \`${r.prompt_version}\` · model \`${r.model ?? "none"}\` · ${r.config.runs} runs × ${r.config.locales.join("/")} × ${r.config.cases.length} cases. Every number below comes from this run (\`eval/report.json\`).`);
  L.push("");
  if (!r.ai_available) {
    L.push(`> **The AI instructor produced no accepted debrief in this run.** Gemini returned: ${r.api_errors.map((e: string) => `\`${e.replace(/^attempt \d+ \[api_error\] /, "").slice(0, 160)}\``).join("; ") || "no response"}.`);
    L.push(`> Every drive therefore received the template fallback, which is what users would see. The AI-only measures below are \`n/a\`; rerun \`npm run eval\` with a valid \`GEMINI_API_KEY\` to fill them.`);
    L.push("");
  }
  L.push(`## Tests`);
  L.push("");
  L.push(r.unit_tests.error ? `Unit tests: ${r.unit_tests.error}` : `Unit tests (Vitest): **${r.unit_tests.passed}/${r.unit_tests.tests} passed** in ${r.unit_tests.files} suites — metrics (one test per metric), readiness, history, schema, auth, device flow, ingest, grounding validator (each rejection type), fallback, retry pipeline, docs/API sync.`);
  L.push("");
  L.push(`## Measures`);
  L.push("");
  L.push(`| Measure | Value | Definition |`);
  L.push(`|---|---|---|`);
  L.push(`| Pipeline runs | ${r.totals.pipeline_runs} (${r.totals.ai_ready} AI, ${r.totals.fallback} fallback) | cases × runs × languages |`);
  L.push(`| Schema validity | ${v(m.schema_validity_first_attempt_pct, "%")} | model output valid JSON matching the schema on the first attempt |`);
  L.push(`| **Grounding rate** | **${v(m.grounding_rate_first_attempt_pct, "%")}** | first attempt passes all 6 validator checks |`);
  L.push(`| Hallucinated references | events ${m.hallucinated_references_first_attempt.unknown_event} · rules ${m.hallucinated_references_first_attempt.unknown_rule} · numbers ${m.hallucinated_references_first_attempt.invented_number} | unknown event ids / rule keys / unseen numbers on first attempts |`);
  L.push(`| Major-fault recall | AI ${v(m.major_fault_recall_ai_pct, "%")} · fallback ${v(m.major_fault_recall_fallback_pct, "%")} | major failed checks covered by an issue |`);
  L.push(`| Prioritisation | ${v(m.prioritisation_ai_pct, "%")} | issue #1 is the most severe fault (AI) |`);
  L.push(`| Consistency | ${v(m.consistency_top_issue_pct, "%")} | same top issue across the runs of a drive+language (AI) |`);
  L.push(`| **Fallback rate** | **${v(m.fallback_rate_pct, "%")}** | runs that ended in the template fallback |`);
  L.push(`| Language check | AI ${v(m.language_check_ai_pct, "%")} · all ${v(m.language_check_all_pct, "%")} | script matches the locale (Cyrillic for RU, Latin with ə/ğ/ı for AZ) |`);
  L.push(`| Latency per debrief | p50 ${v(m.latency_ms.p50, " ms")} · max ${v(m.latency_ms.max, " ms")} | sum over attempts (AI) |`);
  L.push(`| Tokens per debrief | in p50 ${v(m.input_tokens.p50)} / max ${v(m.input_tokens.max)} · out p50 ${v(m.output_tokens.p50)} / max ${v(m.output_tokens.max)} | logged usage, output includes thinking tokens |`);
  const cost = m.cost_usd_per_debrief;
  L.push(`| **Cost per debrief** | ${typeof cost === "string" ? `${cost} — set GEMINI_PRICE_INPUT_PER_M / GEMINI_PRICE_OUTPUT_PER_M from the pricing page` : `p50 $${cost.p50?.toFixed(5) ?? "n/a"} · max $${cost.max?.toFixed(5) ?? "n/a"} (at $${cost.price_in_per_m}/M in, $${cost.price_out_per_m}/M out)`} | logged tokens × current price |`);
  L.push("");
  L.push(`## Compared with what the game shows today`);
  L.push("");
  L.push(`Rules-only baseline = the list of fines the game shows now. Counts per drive (English, run 1): actionable recommendations (issues with a fix + drills), cross-drive insights (progress items), and whether the top item is the most severe fault.`);
  L.push("");
  L.push(`| Drive | Faults | Baseline: actionable / cross-drive / prioritised | Fallback | AI |`);
  L.push(`|---|---|---|---|---|`);
  const yn = (b: boolean | null) => (b === null ? "–" : b ? "yes" : "no");
  for (const c of r.comparison)
    L.push(
      `| ${c.case} | ${c.faults} | ${c.baseline.actionable} / ${c.baseline.cross_drive} / ${yn(c.baseline.prioritised)} | ${c.fallback.actionable} / ${c.fallback.cross_drive} / ${yn(c.fallback.prioritised)}${c.fallback.grounded ? "" : " (not grounded!)"} | ${c.ai ? `${c.ai.actionable} / ${c.ai.cross_drive} / ${yn(c.ai.prioritised)}` : "n/a"} |`,
    );
  L.push("");
  L.push(`Baseline output example (red_light_runner): ${r.comparison.find((c: { case: string }) => c.case === "red_light_runner")?.baseline.lines.map((x: string) => `“${x}”`).join(", ") ?? "–"} — no explanation, no priority, no next step.`);
  L.push("");
  L.push(`## With vs without cross-drive history`);
  L.push("");
  L.push(`| Drive | Previous drives | AI with history (cross-drive / actionable) | AI without | Fallback with / without (cross-drive) |`);
  L.push(`|---|---|---|---|---|`);
  for (const h of r.history_comparison)
    L.push(
      `| ${h.case} | ${h.previous_drives} | ${h.ai_with.runs ? `${h.ai_with.cross_drive} / ${h.ai_with.actionable}` : "n/a"} | ${h.ai_without.runs ? `${h.ai_without.cross_drive} / ${h.ai_without.actionable}` : "n/a"} | ${h.fallback_with.cross_drive} / ${h.fallback_without.cross_drive} |`,
    );
  L.push("");
  L.push(`## Failure examples (caught by the validator)`);
  L.push("");
  if (r.failure_examples.length === 0) {
    L.push(r.ai_available ? `No first attempt was rejected in this run.` : `None — the model was not reachable in this run, so there are no model outputs to reject. The validator's rejection paths are covered by unit tests (\`tests/grounding.test.ts\`: unknown event, unknown rule, wrong event kind, invented number/time, uncovered major, schema).`);
  }
  for (const f of r.failure_examples) {
    L.push(`### ${f.case} (${f.locale}) → ${f.final_status}`);
    L.push("");
    L.push(`Validator reasons:`);
    for (const x of f.reasons) L.push(`- ${x}`);
    L.push("");
    L.push("Rejected output (truncated):");
    L.push("```json");
    L.push(f.rejected_output);
    L.push("```");
    if (f.retry) {
      L.push(`Retry with the reasons appended: ${f.retry.ok ? "**accepted**" : `rejected again (${f.retry.reasons.join("; ")})`}.`);
      L.push("```json");
      L.push(f.retry.output);
      L.push("```");
    }
    L.push("");
  }
  L.push(`## Notes`);
  L.push("");
  L.push(`- All metrics and the readiness score are computed by deterministic code (\`lib/metrics.ts\`, \`lib/readiness.ts\`); the model only explains them, and the validator rejects any number not present in its input.`);
  L.push(`- Fixtures are synthetic (\`scripts/make-fixtures.ts\`); real game drives go in \`eval/real/\` and are picked up automatically. Metric thresholds are starting values until calibrated on real drives (\`eval/CALIBRATION.md\`).`);
  L.push(`- RU and AZ outputs (and all RU/AZ UI strings) are provisional and flagged for native review.`);
  L.push("");
  return L.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
