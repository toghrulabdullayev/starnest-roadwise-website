/**
 * Exam-readiness score (roadwise-ai-instructor §3). Deterministic and explainable:
 * every point comes from a named component the UI can show.
 */
import { harshPer10Min, type DriveMetrics } from "@/lib/metrics";

export const READINESS_WEIGHTS = [0.35, 0.25, 0.2, 0.12, 0.08];
export type ReadinessBand = "not_ready" | "almost" | "ready";
export type ReadinessKey = "majors" | "minors" | "compliance" | "overspeed" | "harsh" | "composure" | "exam_bonus";

export interface ReadinessComponent {
  key: ReadinessKey;
  /** the weighted input value (e.g. majors per drive, compliance rate) */
  value: number;
  /** points added to 100 (≤ 0 except the exam bonus) */
  points: number;
}

export interface Readiness {
  score: number;
  band: ReadinessBand;
  drives_considered: number;
  components: ReadinessComponent[];
}

export function bandFor(score: number): ReadinessBand {
  return score < 50 ? "not_ready" : score < 75 ? "almost" : "ready";
}

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Weighted mean over drives where `get` is not null; weights renormalised. */
function weighted(drives: DriveMetrics[], weights: number[], get: (m: DriveMetrics) => number | null): number | null {
  let sum = 0;
  let w = 0;
  drives.forEach((m, i) => {
    const v = get(m);
    if (v === null) return;
    sum += v * weights[i];
    w += weights[i];
  });
  return w > 0 ? sum / w : null;
}

/** @param latestFirst metrics of the latest ≤ 5 drives, most recent first. */
export function computeReadiness(latestFirst: DriveMetrics[]): Readiness {
  const drives = latestFirst.slice(0, READINESS_WEIGHTS.length);
  if (drives.length === 0) return { score: 0, band: "not_ready", drives_considered: 0, components: [] };
  const weights = READINESS_WEIGHTS.slice(0, drives.length);

  const majors = weighted(drives, weights, (m) => m.major_count) ?? 0;
  const minors = weighted(drives, weights, (m) => m.minor_count) ?? 0;
  // A drive with no rule checks gives no evidence about compliance: skip it.
  const compliance = weighted(drives, weights, (m) => m.compliance_rate) ?? 1;
  const overspeed = weighted(drives, weights, (m) => m.overspeed_time_share) ?? 0;
  const harsh = weighted(drives, weights, harshPer10Min) ?? 0;
  const composure = weighted(drives, weights, (m) => m.composure_index) ?? 100;
  const latestExam = drives.find((m) => m.mode === "exam" && m.exam);
  const examPassed = latestExam?.exam?.passed === true;

  const components: ReadinessComponent[] = [
    { key: "majors", value: r(majors), points: r(-25 * majors, 1) },
    { key: "minors", value: r(minors), points: r(-8 * minors, 1) },
    { key: "compliance", value: r(compliance, 3), points: r(-30 * (1 - compliance), 1) },
    { key: "overspeed", value: r(overspeed, 3), points: r(-20 * overspeed, 1) },
    { key: "harsh", value: r(harsh, 1), points: r(-2 * harsh, 1) },
    { key: "composure", value: r(composure, 0), points: r(-0.15 * (100 - composure), 1) },
    { key: "exam_bonus", value: examPassed ? 1 : 0, points: examPassed ? 5 : 0 },
  ];
  const raw = 100 + components.reduce((a, c) => a + c.points, 0);
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  return { score, band: bandFor(score), drives_considered: drives.length, components };
}
