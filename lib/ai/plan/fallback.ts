import type { Dictionary } from "../../i18n/getDictionary";
import type { RuleTips } from "../tips";
import type { PlanInput } from "./input";
import type { LearningPlan } from "./schema";

export type PlanDictionary = {
  plan: Dictionary["plan"];
  tips: RuleTips;
};

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function buildFallbackPlan(input: PlanInput, dict: PlanDictionary): LearningPlan {
  if (input.focus.length === 0) return { summary: dict.plan.empty, priorities: [] };

  const trendText = {
    improved: dict.plan.trendImproved,
    worse: dict.plan.trendWorse,
    same: dict.plan.trendSame,
  };

  return {
    summary: fill(dict.plan.summary, {
      rules: input.focus.slice(0, 3).map((f) => f.name).join(", "),
    }),
    priorities: input.focus.map((f) => ({
      rule: f.rule,
      why: `${fill(dict.plan.why, { count: f.count, last: f.last_seen })} ${trendText[f.trend]}`,
      practice: dict.tips[f.rule],
    })),
  };
}
