import type { Locale } from "../../i18n/config";
import {
  ruleName,
  RULES,
  SPEED_LIMITS,
  type RuleKey,
} from "../../rules/catalog";

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
      // the model sees band-dependent values as "by_band"
      severity: RULES[key].severity ?? "by_band",
      fine_azn: RULES[key].fineAzn ?? "by_band",
      fine_is_provisional: RULES[key].provisionalFine,
    })),
    speed_limits_kmh: { ...SPEED_LIMITS },
    existing_questions: existing,
  };
}
