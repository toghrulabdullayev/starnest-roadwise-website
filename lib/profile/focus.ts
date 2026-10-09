import { ruleKeys, type RuleKey, type Severity } from "../rules/catalog.ts";
import type { DriveTelemetry } from "../telemetry/schema.ts";

export const RECENCY_DECAY = 0.6;
export const SEVERITY_FACTOR: Record<Severity, number> = { major: 3, minor: 1 };
export const TREND_MARGIN = 0.5;

export type DriveFaults = {
  drive_id: string;
  started_at: string;
  faults: { rule: RuleKey; severity: Severity }[];
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

export function computeFocus(drives: DriveFaults[]): FocusEntry[] {
  const newestFirst = [...drives].sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );

  const entries: FocusEntry[] = [];
  for (const rule of ruleKeys) {
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
      lastSeen ??= drive.started_at;
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
    (a, b) => b.weight - a.weight || ruleKeys.indexOf(a.rule) - ruleKeys.indexOf(b.rule),
  );
}

export function focusFromTelemetry(drives: DriveTelemetry[]): FocusEntry[] {
  return computeFocus(drives.map(faultsFromTelemetry));
}
