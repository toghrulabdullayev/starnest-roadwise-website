import type { Locale } from "../../i18n/config";
import type { FocusEntry } from "../../profile/focus";
import { RULES, ruleName, type RuleKey } from "../../rules/catalog";

export const MAX_PLAN_RULES = 5;

export type PlanInput = {
  focus: {
    rule: RuleKey;
    name: string;
    severity: string;
    weight: number;
    count: number;
    last_seen: string;
    trend: FocusEntry["trend"];
  }[];
};

export function buildPlanInput(focus: FocusEntry[], locale: Locale): PlanInput {
  return {
    focus: focus.slice(0, MAX_PLAN_RULES).map((f) => ({
      rule: f.rule,
      name: ruleName(f.rule, locale),
      severity: RULES[f.rule].severity ?? "by_band",
      weight: f.weight,
      count: f.count,
      last_seen: f.last_seen.slice(0, 10),
      trend: f.trend,
    })),
  };
}
