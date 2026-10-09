import type { RuleKey } from "../rules/catalog.ts";

export type QuizQuestion = {
  id: string;
  rule: RuleKey;
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
  source: "bank" | "template" | "generated";
};

export type Quiz = {
  id: string;
  locale: string;
  questions: QuizQuestion[];
  weak_rules: RuleKey[];
};

export type QuizAnswer = { question_id: string; chosen_index: number };

export type QuizResult = {
  correct: number;
  total: number;
  wrong: { question_id: string; rule: RuleKey }[];
  wrong_by_rule: Partial<Record<RuleKey, number>>;
};
