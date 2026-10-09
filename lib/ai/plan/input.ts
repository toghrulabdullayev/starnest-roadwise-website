import type { Locale } from "../../i18n/config";
import { fmtDate } from "../../i18n/format";
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
    /** localized date ("7 Oct 2026"), the form the plan text may quote */
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
      last_seen: fmtDate(locale, f.last_seen, false),
      trend: f.trend,
    })),
  };
}
