/**
 * Cross-drive comparison (roadwise-ai-instructor §4): the current drive vs the mean
 * of up to 4 previous drives. First drive → null.
 */
import { harshPer10Min, type DriveMetrics } from "@/lib/metrics";
import { RULE_KEYS, type RuleKey } from "@/lib/rules/catalog";

export type Direction = "improved" | "worse" | "same";
export type HistoryKey = "compliance_rate" | "fines_azn" | "overspeed_time_share" | "harsh_per_10min" | "composure_index";

export interface HistoryDelta {
  key: HistoryKey;
  current: number;
  previous_mean: number;
  delta: number;
  direction: Direction;
}

export interface RuleDelta {
  rule: RuleKey;
  current: number;
  previous_mean: number;
  direction: Direction;
}

export interface History {
  previous_count: number;
  deltas: HistoryDelta[];
  rules: RuleDelta[];
}

export const MAX_PREVIOUS = 4;

/** Smallest change that counts; better = which direction is good. */
export const HISTORY_CONFIG: Record<HistoryKey, { min: number; better: "higher" | "lower"; get: (m: DriveMetrics) => number | null }> = {
  compliance_rate: { min: 0.05, better: "higher", get: (m) => m.compliance_rate },
  fines_azn: { min: 10, better: "lower", get: (m) => m.fines_total_azn },
  overspeed_time_share: { min: 0.02, better: "lower", get: (m) => m.overspeed_time_share },
  harsh_per_10min: { min: 1, better: "lower", get: harshPer10Min },
  composure_index: { min: 5, better: "higher", get: (m) => m.composure_index },
};
const RULE_MIN_CHANGE = 0.5;

const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function direction(delta: number, min: number, better: "higher" | "lower"): Direction {
  if (Math.abs(delta) < min) return "same";
  return (delta > 0) === (better === "higher") ? "improved" : "worse";
}

/** @param previousLatestFirst metrics of earlier drives, most recent first (only the first 4 are used). */
export function computeHistory(current: DriveMetrics, previousLatestFirst: DriveMetrics[]): History | null {
  const prev = previousLatestFirst.slice(0, MAX_PREVIOUS);
  if (prev.length === 0) return null;

  const deltas: HistoryDelta[] = [];
  for (const key of Object.keys(HISTORY_CONFIG) as HistoryKey[]) {
    const { min, better, get } = HISTORY_CONFIG[key];
    const cur = get(current);
    const vals = prev.map(get).filter((v): v is number => v !== null);
    if (cur === null || vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const delta = cur - mean;
    deltas.push({ key, current: r(cur), previous_mean: r(mean), delta: r(delta), direction: direction(delta, min, better) });
  }

  const rules: RuleDelta[] = [];
  for (const rule of RULE_KEYS) {
    const cur = current.violations_by_rule[rule]?.count ?? 0;
    const mean = prev.reduce((a, m) => a + (m.violations_by_rule[rule]?.count ?? 0), 0) / prev.length;
    if (cur === 0 && mean === 0) continue;
    rules.push({ rule, current: cur, previous_mean: r(mean, 2), direction: direction(cur - mean, RULE_MIN_CHANGE, "lower") });
  }
  return { previous_count: prev.length, deltas, rules };
}
