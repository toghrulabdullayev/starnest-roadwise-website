import type { ExamBrief } from "../exam/adaptive";
import type { RuleKey } from "../rules/catalog";
import { SEVERITY_FACTOR, type DriveFaults, type FocusEntry } from "./focus";

export type Outcome = "improved" | "same" | "worse";

export type RuleOutcome = {
  rule: RuleKey;
  outcome: Outcome;
  faults_in_exam: number;
  previous_weight: number;
  next_weight: number;
};

export type ExamComparison = {
  results: RuleOutcome[];
  improved: number;
  same: number;
  worse: number;
};

export function compareExamWithBrief(options: {
  brief: ExamBrief;
  exam: DriveFaults;
  nextFocus: FocusEntry[];
}): ExamComparison {
  const { brief, exam, nextFocus } = options;

  const results: RuleOutcome[] = brief.focus_rules.map((target) => {
    const faults = exam.faults.filter((f) => f.rule === target.rule);
    const faultWeight = faults.reduce((n, f) => n + SEVERITY_FACTOR[f.severity], 0);
    const next = nextFocus.find((f) => f.rule === target.rule)?.weight ?? 0;

    let outcome: Outcome;
    if (faults.length === 0) outcome = "improved";
    else if (faultWeight > 0 && next >= target.weight) outcome = "worse";
    else outcome = "same";

    return {
      rule: target.rule,
      outcome,
      faults_in_exam: faults.length,
      previous_weight: target.weight,
      next_weight: next,
    };
  });

  return {
    results,
    improved: results.filter((r) => r.outcome === "improved").length,
    same: results.filter((r) => r.outcome === "same").length,
    worse: results.filter((r) => r.outcome === "worse").length,
  };
}
