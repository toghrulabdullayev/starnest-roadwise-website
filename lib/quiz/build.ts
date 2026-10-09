import type { Locale } from "../i18n/config";
import type { Dictionary } from "../i18n/getDictionary";
import type { FocusEntry } from "../profile/focus.ts";
import { hashString, mulberry32, pickWeighted, shuffle } from "../random.ts";
import { ruleKeys, type RuleKey } from "../rules/catalog.ts";
import { bankQuestions, templateQuestions } from "./questions.ts";
import type { Quiz, QuizQuestion } from "./types.ts";

export const DEFAULT_QUIZ_SIZE = 10;
export const WEAK_SHARE = 0.7;

export function buildQuiz(options: {
  locale: Locale;
  dictionary: Dictionary["quiz"];
  focus?: FocusEntry[];
  size?: number;
  seed: number;
  extra?: QuizQuestion[];
}): Quiz {
  const { locale } = options;
  const size = options.size ?? DEFAULT_QUIZ_SIZE;
  const focus = options.focus ?? [];
  const rng = mulberry32(options.seed);

  const all = [
    ...bankQuestions(locale),
    ...templateQuestions(locale, options.dictionary),
    ...(options.extra ?? []),
  ];
  const remaining = new Map<RuleKey, QuizQuestion[]>();
  for (const rule of ruleKeys) remaining.set(rule, []);
  for (const q of shuffle(all, rng)) remaining.get(q.rule)!.push(q);

  const weights = new Map(focus.map((f) => [f.rule, f.weight]));
  const chosen: QuizQuestion[] = [];

  const take = (rule: RuleKey) => {
    const q = remaining.get(rule)!.pop();
    if (q) chosen.push(q);
  };
  const available = () => ruleKeys.filter((r) => remaining.get(r)!.length > 0);

  const weakTarget = focus.length > 0 ? Math.round(size * WEAK_SHARE) : 0;
  while (chosen.length < weakTarget) {
    const pool = available().filter((r) => weights.has(r));
    const rule = pickWeighted(pool, (r) => weights.get(r) ?? 0, rng);
    if (!rule) break;
    take(rule);
  }
  while (chosen.length < size) {
    const rule = pickWeighted(available(), () => 1, rng);
    if (!rule) break;
    take(rule);
  }

  const questions = shuffle(chosen, rng).map((q) => {
    const order = shuffle(
      q.options.map((_, i) => i),
      rng,
    );
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      correct_index: order.indexOf(q.correct_index),
    };
  });

  return {
    id: `quiz-${options.seed}-${hashString(questions.map((q) => q.id).join("|"))}`,
    locale,
    questions,
    weak_rules: focus.map((f) => f.rule),
  };
}
