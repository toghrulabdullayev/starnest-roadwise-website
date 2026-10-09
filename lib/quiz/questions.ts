import type { Locale } from "../i18n/config";
import type { Dictionary } from "../i18n/getDictionary";
import {
  ruleKeys,
  ruleName,
  rules,
  speedLimitsKmh,
  type RuleKey,
} from "../rules/catalog.ts";
import bank from "./bank.json";
import type { QuizQuestion } from "./types.ts";

type BankEntry = {
  id: string;
  rule: RuleKey;
  correct: number;
} & Record<Locale, { q: string; o: string[]; e: string }>;

const FINE_POOL = [10, 40, 50, 100, 150, 200, 300];

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function distractors<T>(pool: readonly T[], correct: T, count: number): T[] {
  const rest = pool.filter((p) => p !== correct);
  const step = Math.max(1, Math.floor(rest.length / count));
  const out: T[] = [];
  for (let i = 0; i < rest.length && out.length < count; i += step) out.push(rest[i]);
  return out;
}

export function bankQuestions(locale: Locale): QuizQuestion[] {
  return (bank as BankEntry[]).map((entry) => ({
    id: entry.id,
    rule: entry.rule,
    text: entry[locale].q,
    options: entry[locale].o,
    correct_index: entry.correct,
    explanation: entry[locale].e,
    source: "bank" as const,
  }));
}

export function templateQuestions(
  locale: Locale,
  dict: Dictionary["quiz"],
): QuizQuestion[] {
  const out: QuizQuestion[] = [];

  for (const key of ruleKeys) {
    const rule = rules[key];
    const name = ruleName(key, locale);

    if (typeof rule.fineAzn === "number" && !rule.provisional) {
      const options = [rule.fineAzn, ...distractors(FINE_POOL, rule.fineAzn, 3)];
      out.push({
        id: `tpl:fine:${key}`,
        rule: key,
        text: fill(dict.fineQuestion, { rule: name }),
        options: options.map((fine) => fill(dict.fineUnit, { fine })),
        correct_index: 0,
        explanation: fill(dict.fineExplain, { rule: name, fine: rule.fineAzn }),
        source: "template",
      });
    }

    if (rule.severity !== "by_band") {
      const major = rule.severity === "major";
      out.push({
        id: `tpl:severity:${key}`,
        rule: key,
        text: fill(dict.severityQuestion, { rule: name }),
        options: [
          major ? dict.severityMajor : dict.severityMinor,
          major ? dict.severityMinor : dict.severityMajor,
          dict.severityNone,
          dict.severityWarning,
        ],
        correct_index: 0,
        explanation: fill(major ? dict.severityExplainMajor : dict.severityExplainMinor, {
          rule: name,
        }),
        source: "template",
      });
    }
  }

  const zones = Object.keys(speedLimitsKmh) as (keyof typeof speedLimitsKmh)[];
  const limits = zones.map((z) => speedLimitsKmh[z]);
  for (const zone of zones) {
    const limit = speedLimitsKmh[zone];
    const zoneName = dict.zones[zone];
    out.push({
      id: `tpl:limit:${zone}`,
      rule: "speeding",
      text: fill(dict.limitQuestion, { zone: zoneName }),
      options: [limit, ...distractors(limits, limit, 3)].map((l) =>
        fill(dict.limitUnit, { limit: l }),
      ),
      correct_index: 0,
      explanation: fill(dict.limitExplain, { zone: zoneName, limit }),
      source: "template",
    });
  }

  return out;
}
