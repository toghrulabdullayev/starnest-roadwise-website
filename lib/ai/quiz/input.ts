import type { Locale } from "../../i18n/config";
import {
  ruleName,
  rules,
  speedLimitsKmh,
  type RuleKey,
} from "../../rules/catalog.ts";

export type QuizGenInput = {
  count: number;
  rules: {
    key: RuleKey;
    name: string;
    severity: string;
    fine_azn: number | string;
    fine_is_provisional: boolean;
  }[];
  speed_limits_kmh: Record<string, number>;
  existing_questions: string[];
};

export function buildQuizGenInput(
  ruleList: RuleKey[],
  count: number,
  locale: Locale,
  existing: string[],
): QuizGenInput {
  return {
    count,
    rules: [...new Set(ruleList)].map((key) => ({
      key,
      name: ruleName(key, locale),
      severity: rules[key].severity,
      fine_azn: rules[key].fineAzn,
      fine_is_provisional: rules[key].provisional,
    })),
    speed_limits_kmh: { ...speedLimitsKmh },
    existing_questions: existing,
  };
}
