/**
 * Builds the model input from deterministic outputs only (never raw samples, email or name).
 * Numbers appear here in the forms the debrief may quote (grounding check 5 compares against this).
 * Every key the model might mention travels with its localized `label`/`name`, so the text can
 * use words instead of identifiers (grounding check 7).
 */
import type { DriveMetrics } from "@/lib/metrics";
import type { Readiness } from "@/lib/readiness";
import type { History } from "@/lib/history";
import { RULES, ruleName, type RuleKey } from "@/lib/rules/catalog";
import { isRuleCheck, type DriveTelemetry } from "@/lib/telemetry/schema";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";

export const MAX_PASSES_IN_INPUT = 10;

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const pct = (x: number | null) => (x === null ? null : Math.round(x * 100));
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface DebriefEvent {
  id: string;
  time: string;
  rule: RuleKey;
  outcome: "pass" | "fail";
  severity?: "major" | "minor";
  fine_azn?: number;
  street?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface DebriefInput {
  context: {
    mode: "free" | "exam";
    /** localized district name; null when the game sends a district the dictionary does not know */
    district: string | null;
    time_of_day: string;
    duration: string;
    distance_km: number;
    exam: DriveTelemetry["drive"]["exam"];
  };
  metrics: Record<string, number | null>;
  readiness: {
    score: number;
    band: string;
    band_label: string;
    components: { key: string; label: string; value: number; points: number }[];
  };
  history: {
    previous_drives: number;
    changes: { key: string; label: string; current: number; previous_mean: number; direction: string }[];
    rules: { rule: string; name: string; current: number; previous_mean: number; direction: string }[];
  } | null;
  units: { speed: string; distance: string; money: string };
  events: DebriefEvent[];
  rules: { key: RuleKey; name: string; severity: string; fine_azn: number | null }[];
}

export function buildDebriefInput(args: {
  telemetry: DriveTelemetry;
  metrics: DriveMetrics;
  readiness: Readiness;
  history: History | null;
  locale: Locale;
  /** eval: drop history to measure what cross-drive context adds */
  withHistory?: boolean;
}): DebriefInput {
  const { telemetry, metrics: m, readiness, locale } = args;
  const dict = getDictionary(locale);
  const districts: Record<string, string> = dict.districts;
  const history = args.withHistory === false ? null : args.history;
  const checks = telemetry.events.filter(isRuleCheck);
  const failed = checks.filter((e) => e.outcome === "fail");
  const passes = checks.filter((e) => e.outcome === "pass").slice(0, MAX_PASSES_IN_INPUT);
  const kept = new Set([...failed, ...passes].map((e) => e.id));
  const events: DebriefEvent[] = checks
    .filter((e) => kept.has(e.id))
    .map((e) => ({
      id: e.id,
      time: mmss(e.t),
      rule: e.rule,
      outcome: e.outcome,
      ...(e.severity ? { severity: e.severity } : {}),
      ...(e.fine_azn !== undefined ? { fine_azn: e.fine_azn } : {}),
      ...(e.street ? { street: e.street } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    }));
  const present = [...new Set(events.map((e) => e.rule))];

  return {
    context: {
      mode: telemetry.drive.mode,
      district: (telemetry.drive.district && districts[telemetry.drive.district]) || null,
      time_of_day: telemetry.drive.time_of_day,
      duration: mmss(telemetry.drive.duration_s),
      distance_km: r1(telemetry.drive.distance_m / 1000),
      exam: telemetry.drive.exam,
    },
    metrics: {
      checks_total: m.checks_total,
      checks_passed: m.checks_passed,
      compliance_pct: pct(m.compliance_rate),
      fines_total_azn: m.fines_total_azn,
      major_count: m.major_count,
      minor_count: m.minor_count,
      overspeed_time_pct: pct(m.overspeed_time_share),
      mean_overspeed_kmh: m.mean_overspeed_kmh,
      avg_speed_kmh: m.avg_speed_kmh,
      max_speed_kmh: m.max_speed_kmh,
      harsh_brake_count: m.harsh_brake_count,
      harsh_accel_count: m.harsh_accel_count,
      steer_reversals_per_min: m.steer_reversals_per_min,
      hesitation_stops: m.hesitation_stops,
      composure_index: m.composure_index,
      collisions: m.collisions,
    },
    readiness: {
      score: readiness.score,
      band: readiness.band,
      band_label: dict.readiness.bands[readiness.band],
      components: readiness.components.map((c) => ({
        key: c.key,
        label: dict.readiness.components[c.key as keyof typeof dict.readiness.components] ?? c.key,
        value: c.value,
        points: c.points,
      })),
    },
    history: history
      ? {
          previous_drives: history.previous_count,
          changes: history.deltas.map((d) => ({
            key: d.key,
            label: dict.history.keys[d.key as keyof typeof dict.history.keys] ?? d.key,
            current: d.key === "compliance_rate" || d.key === "overspeed_time_share" ? pct(d.current)! : r1(d.current),
            previous_mean: d.key === "compliance_rate" || d.key === "overspeed_time_share" ? pct(d.previous_mean)! : r1(d.previous_mean),
            direction: d.direction,
          })),
          rules: history.rules.map((r) => ({
            rule: r.rule,
            name: ruleName(r.rule, locale),
            current: r.current,
            previous_mean: r.previous_mean,
            direction: r.direction,
          })),
        }
      : null,
    units: { speed: dict.units.kmh, distance: dict.units.km, money: "AZN" },
    events,
    rules: present.map((key) => ({
      key,
      name: RULES[key].names[locale],
      severity: RULES[key].severity ?? "by speed band",
      fine_azn: RULES[key].fineAzn,
    })),
  };
}
