import type { Locale } from "../../i18n/config";
import {
  isRuleKey,
  ruleName,
  rules,
  type RuleKey,
  type Severity,
} from "../../rules/catalog.ts";
import type { DriveTelemetry } from "../../telemetry/schema.ts";

export const MAX_PASS_EVENTS = 10;

export type DebriefEvent = {
  id: string;
  time: string;
  rule: RuleKey;
  outcome: "pass" | "fail";
  severity?: Severity;
  fine_azn?: number;
  street?: string;
  detail?: Record<string, unknown>;
};

export type DebriefInput = {
  context: {
    mode: "free" | "exam";
    district: string;
    duration: string;
    distance_m: number;
    exam_passed: boolean | null;
  };
  metrics: {
    checks_total: number;
    checks_passed: number;
    compliance_percent: number | null;
    fines_total_azn: number;
    major_count: number;
    minor_count: number;
    violations_by_rule: Record<string, { count: number; fines_azn: number }>;
  };
  events: DebriefEvent[];
  rules: { key: RuleKey; name: string; severity: string; fine_azn: number | string }[];
  history: null;
};

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function buildDebriefInput(
  telemetry: DriveTelemetry,
  locale: Locale,
): DebriefInput {
  const checks = telemetry.events.filter((e) => e.type === "rule_check");
  const fails = checks.filter((e) => e.outcome === "fail");
  const passes = checks.filter((e) => e.outcome === "pass");

  const violations: DebriefInput["metrics"]["violations_by_rule"] = {};
  for (const f of fails) {
    violations[f.rule] ??= { count: 0, fines_azn: 0 };
    violations[f.rule].count++;
    violations[f.rule].fines_azn += f.fine_azn ?? 0;
  }

  const selected = [...fails, ...passes.slice(0, MAX_PASS_EVENTS)].sort(
    (a, b) => a.t - b.t,
  );
  const events: DebriefEvent[] = selected.map((e) => ({
    id: e.id,
    time: formatClock(e.t),
    rule: e.rule,
    outcome: e.outcome,
    ...(e.severity ? { severity: e.severity } : {}),
    ...(e.fine_azn !== undefined ? { fine_azn: e.fine_azn } : {}),
    ...(e.street ? { street: e.street } : {}),
    ...(e.detail ? { detail: e.detail } : {}),
  }));

  const present = [...new Set(events.map((e) => e.rule))].filter(isRuleKey);
  return {
    context: {
      mode: telemetry.drive.mode,
      district: telemetry.drive.district,
      duration: formatClock(telemetry.drive.duration_s),
      distance_m: Math.round(telemetry.drive.distance_m),
      exam_passed: telemetry.drive.exam ? telemetry.drive.exam.passed : null,
    },
    metrics: {
      checks_total: checks.length,
      checks_passed: passes.length,
      compliance_percent:
        checks.length === 0
          ? null
          : Math.round((passes.length / checks.length) * 100),
      fines_total_azn: fails.reduce((n, f) => n + (f.fine_azn ?? 0), 0),
      major_count: fails.filter((f) => f.severity === "major").length,
      minor_count: fails.filter((f) => f.severity === "minor").length,
      violations_by_rule: violations,
    },
    events,
    rules: present.map((key) => ({
      key,
      name: ruleName(key, locale),
      severity: rules[key].severity,
      fine_azn: rules[key].fineAzn,
    })),
    history: null,
  };
}
