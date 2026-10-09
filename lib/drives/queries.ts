import { query, queryOne } from "@/lib/db";
import type { DriveMetrics } from "@/lib/metrics";
import type { Readiness } from "@/lib/readiness";
import type { History } from "@/lib/history";
import type { DriveTelemetry } from "@/lib/telemetry/schema";
import { isLocale, type Locale } from "@/lib/i18n/config";

export type DebriefStatus = "pending" | "ready" | "fallback" | "error";

export interface DriveSummary {
  id: string;
  source: "game" | "fixture";
  mode: "free" | "exam";
  district: string | null;
  started_at: string;
  duration_s: number;
  distance_m: number;
  exam_passed: boolean | null;
  compliance_rate: number | null;
  fines_total_azn: number;
  major_count: number;
  minor_count: number;
  composure_index: number;
  readiness_score: number;
}

type DriveRow = {
  id: string;
  user_id: string;
  client_drive_id: string;
  source: "game" | "fixture";
  mode: "free" | "exam";
  district: string | null;
  route_id: string | null;
  started_at: string;
  duration_s: number;
  distance_m: number;
  exam_passed: number | null;
  metrics: string;
  readiness: string;
  history: string | null;
  telemetry?: string;
};

function summary(r: DriveRow): DriveSummary {
  const m = JSON.parse(r.metrics) as DriveMetrics;
  const rd = JSON.parse(r.readiness) as Readiness;
  return {
    id: r.id,
    source: r.source,
    mode: r.mode,
    district: r.district,
    started_at: r.started_at,
    duration_s: r.duration_s,
    distance_m: r.distance_m,
    exam_passed: r.exam_passed === null ? null : r.exam_passed === 1,
    compliance_rate: m.compliance_rate,
    fines_total_azn: m.fines_total_azn,
    major_count: m.major_count,
    minor_count: m.minor_count,
    composure_index: m.composure_index,
    readiness_score: rd.score,
  };
}

/** Latest drives first. */
export async function listDrives(userId: string, limit = 50): Promise<DriveSummary[]> {
  const rows = await query<DriveRow>(
    `SELECT id, user_id, client_drive_id, source, mode, district, route_id, started_at, duration_s, distance_m, exam_passed,
            metrics, readiness, history
     FROM drives WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map(summary);
}

/** All drives' metrics + readiness, oldest first (profile charts). */
export async function driveSeries(userId: string, limit = 50) {
  const rows = await query<DriveRow>(
    `SELECT id, user_id, client_drive_id, source, mode, district, route_id, started_at, duration_s, distance_m, exam_passed,
            metrics, readiness, history
     FROM drives WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.reverse().map((r) => ({
    ...summary(r),
    metrics: JSON.parse(r.metrics) as DriveMetrics,
    readiness: JSON.parse(r.readiness) as Readiness,
  }));
}

export interface DriveDetail extends DriveSummary {
  client_drive_id: string;
  route_id: string | null;
  metrics: DriveMetrics;
  readiness: Readiness;
  history: History | null;
}

export async function getDrive(id: string, userId: string, withTelemetry = false) {
  const row = await queryOne<DriveRow>(
    `SELECT id, user_id, client_drive_id, source, mode, district, route_id, started_at, duration_s, distance_m, exam_passed,
            metrics, readiness, history${withTelemetry ? ", telemetry" : ""}
     FROM drives WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!row) return null;
  const detail: DriveDetail & { telemetry?: DriveTelemetry } = {
    ...summary(row),
    client_drive_id: row.client_drive_id,
    route_id: row.route_id,
    metrics: JSON.parse(row.metrics),
    readiness: JSON.parse(row.readiness),
    history: row.history ? JSON.parse(row.history) : null,
  };
  if (withTelemetry && row.telemetry) detail.telemetry = JSON.parse(row.telemetry);
  return detail;
}

export interface DebriefRecord {
  locale: Locale;
  status: DebriefStatus;
  debrief: unknown | null;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
}

/** Debrief in the requested locale, else any available one (ready/fallback preferred). */
export async function getDebrief(driveId: string, locale: Locale): Promise<{ record: DebriefRecord | null; available: Locale[] }> {
  const rows = await query<{ locale: string; status: DebriefStatus; debrief: string | null; model: string | null; prompt_version: string | null; created_at: string }>(
    "SELECT locale, status, debrief, model, prompt_version, created_at FROM drive_debriefs WHERE drive_id = ?",
    [driveId],
  );
  const recs: DebriefRecord[] = rows
    .filter((r) => isLocale(r.locale))
    .map((r) => ({ ...r, locale: r.locale as Locale, debrief: r.debrief ? JSON.parse(r.debrief) : null }));
  const done = (r: DebriefRecord) => r.status === "ready" || r.status === "fallback";
  const record = recs.find((r) => r.locale === locale) ?? recs.find(done) ?? recs[0] ?? null;
  return { record, available: recs.filter(done).map((r) => r.locale) };
}
