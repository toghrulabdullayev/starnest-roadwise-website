import { RULE_KEYS, type RuleKey, type Severity } from "../rules/catalog";
import type { DriveTelemetry } from "../telemetry/schema";

export const RECENCY_DECAY = 0.6;
export const QUIZ_FACTOR = 0.5;
export const SEVERITY_FACTOR: Record<Severity | "quiz", number> = {
  major: 3,
  minor: 1,
  quiz: QUIZ_FACTOR,
};
export const TREND_MARGIN = 0.5;

export type DriveFaults = {
  drive_id: string;
  started_at: string;
  faults: { rule: RuleKey; severity: Severity | "quiz" }[];
};

export type Trend = "improved" | "same" | "worse";

export type FocusEntry = {
  rule: RuleKey;
  weight: number;
  count: number;
  last_seen: string;
  trend: Trend;
};

export function faultsFromTelemetry(telemetry: DriveTelemetry): DriveFaults {
  return {
    drive_id: telemetry.drive.client_drive_id,
    started_at: telemetry.drive.started_at,
    faults: telemetry.events.flatMap((e) =>
      e.type === "rule_check" && e.outcome === "fail" && e.severity
        ? [{ rule: e.rule, severity: e.severity }]
        : [],
    ),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const newestFirstOf = (list: DriveFaults[]) =>
  [...list].sort((a, b) => b.started_at.localeCompare(a.started_at));

/** Quizzes decay on their own timeline, so taking a quiz does not push real drives further into the past. */
export function computeFocus(drives: DriveFaults[], quizzes: DriveFaults[] = []): FocusEntry[] {
  const newestFirst = newestFirstOf(drives);
  const newestQuizzes = newestFirstOf(quizzes);

  const entries: FocusEntry[] = [];
  for (const rule of RULE_KEYS) {
    let weight = 0;
    let count = 0;
    let lastSeen: string | null = null;
    const countsPerDrive: number[] = [];

    newestFirst.forEach((drive, index) => {
      const mine = drive.faults.filter((f) => f.rule === rule);
      countsPerDrive.push(mine.length);
      if (mine.length === 0) return;
      const decay = RECENCY_DECAY ** index;
      weight += decay * mine.reduce((n, f) => n + SEVERITY_FACTOR[f.severity], 0);
      count += mine.length;
      if (lastSeen === null || drive.started_at > lastSeen) lastSeen = drive.started_at;
    });

    newestQuizzes.forEach((quiz, index) => {
      const mine = quiz.faults.filter((f) => f.rule === rule);
      if (mine.length === 0) return;
      weight += RECENCY_DECAY ** index * mine.reduce((n, f) => n + SEVERITY_FACTOR[f.severity], 0);
      count += mine.length;
      if (lastSeen === null || quiz.started_at > lastSeen) lastSeen = quiz.started_at;
    });

    if (weight === 0 || lastSeen === null) continue;

    let trend: Trend = "same";
    if (countsPerDrive.length > 1) {
      const newest = countsPerDrive[0];
      const earlier = countsPerDrive.slice(1);
      const mean = earlier.reduce((a, b) => a + b, 0) / earlier.length;
      if (newest < mean - TREND_MARGIN) trend = "improved";
      else if (newest > mean + TREND_MARGIN) trend = "worse";
    }

    entries.push({ rule, weight: round2(weight), count, last_seen: lastSeen, trend });
  }

  return entries.sort(
    (a, b) => b.weight - a.weight || RULE_KEYS.indexOf(a.rule) - RULE_KEYS.indexOf(b.rule),
  );
}

export function focusFromTelemetry(drives: DriveTelemetry[]): FocusEntry[] {
  return computeFocus(drives.map(faultsFromTelemetry));
}
