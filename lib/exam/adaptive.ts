import type { FocusEntry, Trend } from "../profile/focus.ts";
import type { RuleKey } from "../rules/catalog.ts";

export const BRIEF_VERSION = "exam-brief-1";
export const MAX_FOCUS_RULES = 3;
export const STRUGGLING_TOTAL_WEIGHT = 6;

export const EXAM_PROFILES = {
  easy: { target_length_m: 2500, repeats_per_rule: 3 },
  standard: { target_length_m: 3500, repeats_per_rule: 2 },
  hard: { target_length_m: 4500, repeats_per_rule: 1 },
} as const;

export type Difficulty = keyof typeof EXAM_PROFILES;
export type BriefReason = "no_history" | "clean" | "weaknesses";

export type ExamBrief = {
  version: string;
  reason: BriefReason;
  difficulty: Difficulty;
  target_length_m: number;
  repeats_per_rule: number;
  focus_rules: { rule: RuleKey; weight: number; trend: Trend }[];
};

export function buildExamBrief(options: {
  focus: FocusEntry[];
  drivesCount: number;
}): ExamBrief {
  const { focus, drivesCount } = options;

  let reason: BriefReason;
  let difficulty: Difficulty;
  if (focus.length > 0) {
    reason = "weaknesses";
    const total = focus.reduce((n, f) => n + f.weight, 0);
    difficulty = total >= STRUGGLING_TOTAL_WEIGHT ? "easy" : "standard";
  } else if (drivesCount > 0) {
    reason = "clean";
    difficulty = "hard";
  } else {
    reason = "no_history";
    difficulty = "standard";
  }

  const profile = EXAM_PROFILES[difficulty];
  return {
    version: BRIEF_VERSION,
    reason,
    difficulty,
    target_length_m: profile.target_length_m,
    repeats_per_rule: profile.repeats_per_rule,
    focus_rules: focus.slice(0, MAX_FOCUS_RULES).map((f) => ({
      rule: f.rule,
      weight: f.weight,
      trend: f.trend,
    })),
  };
}
