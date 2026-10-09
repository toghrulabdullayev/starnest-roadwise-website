/**
 * The one ingest path, shared by POST /api/drives, scripts/seed-demo.ts and the eval harness.
 * validate (caller) → metrics → readiness → history → store drive + pending debrief.
 * The debrief itself is generated afterwards (lib/instructor via the route's after()).
 */
import { randomUUID } from "node:crypto";
import { batch, query, queryOne } from "@/lib/db";
import { computeMetrics, type DriveMetrics } from "@/lib/metrics";
import { computeReadiness, type Readiness } from "@/lib/readiness";
import { computeHistory, MAX_PREVIOUS, type History } from "@/lib/history";
import { READINESS_WEIGHTS } from "@/lib/readiness";
import { eventStatements } from "@/lib/drives/events";
import { recordExamComparison } from "@/lib/exam/briefs";
import type { DriveTelemetry } from "@/lib/telemetry/schema";
import type { Locale } from "@/lib/i18n/config";

export interface IngestResult {
  id: string;
  created: boolean;
  metrics: DriveMetrics;
  readiness: Readiness;
  history: History | null;
  debrief_status: "pending" | "ready" | "fallback" | "error";
  locale: Locale;
}

/** Metrics of the user's drives that started before `startedAt`, most recent first. */
async function previousMetrics(userId: string, startedAt: string, limit: number): Promise<DriveMetrics[]> {
  const rows = await query<{ metrics: string }>(
    "SELECT metrics FROM drives WHERE user_id = ? AND started_at < ? AND metrics IS NOT NULL ORDER BY started_at DESC LIMIT ?",
    [userId, startedAt, limit],
  );
  return rows.map((r) => JSON.parse(r.metrics) as DriveMetrics);
}

async function existing(userId: string, clientDriveId: string): Promise<IngestResult | null> {
  const row = await queryOne<{ id: string; metrics: string; readiness: string; history: string | null }>(
    "SELECT id, metrics, readiness, history FROM drives WHERE user_id = ? AND client_drive_id = ?",
    [userId, clientDriveId],
  );
  if (!row) return null;
  const debrief = await queryOne<{ status: IngestResult["debrief_status"]; locale: Locale }>(
    "SELECT status, locale FROM drive_debriefs WHERE drive_id = ? ORDER BY created_at LIMIT 1",
    [row.id],
  );
  return {
    id: row.id,
    created: false,
    metrics: JSON.parse(row.metrics),
    readiness: JSON.parse(row.readiness),
    history: row.history ? JSON.parse(row.history) : null,
    debrief_status: debrief?.status ?? "pending",
    locale: debrief?.locale ?? "en",
  };
}

export async function ingestDrive(
  user: { id: string; locale: Locale },
  telemetry: DriveTelemetry,
  opts: { source?: "game" | "fixture" } = {},
): Promise<IngestResult> {
  const clientDriveId = telemetry.drive.client_drive_id;
  const found = await existing(user.id, clientDriveId);
  if (found) return found;

  const startedAt = new Date(telemetry.drive.started_at).toISOString();
  const metrics = computeMetrics(telemetry);
  const previous = await previousMetrics(user.id, startedAt, Math.max(MAX_PREVIOUS, READINESS_WEIGHTS.length - 1));
  const readiness = computeReadiness([metrics, ...previous]);
  const history = computeHistory(metrics, previous);
  const id = randomUUID();

  try {
    await batch([
      {
        sql: `INSERT INTO drives (id, user_id, client_drive_id, source, mode, district, route_id, started_at, duration_s, distance_m,
                exam_passed, telemetry, metrics, readiness, history)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          user.id,
          clientDriveId,
          opts.source ?? "game",
          telemetry.drive.mode,
          telemetry.drive.district ?? null,
          telemetry.drive.route_id ?? null,
          startedAt,
          telemetry.drive.duration_s,
          telemetry.drive.distance_m,
          telemetry.drive.exam ? (telemetry.drive.exam.passed ? 1 : 0) : null,
          JSON.stringify(telemetry),
          JSON.stringify(metrics),
          JSON.stringify(readiness),
          history ? JSON.stringify(history) : null,
        ],
      },
      { sql: "INSERT INTO drive_debriefs (drive_id, locale, status) VALUES (?, ?, 'pending')", args: [id, user.locale] },
      ...eventStatements(id, user.id, telemetry, startedAt),
    ]);
  } catch (err) {
    // A concurrent upload of the same drive won the UNIQUE (user_id, client_drive_id) race.
    if (String(err).includes("UNIQUE")) {
      const raced = await existing(user.id, clientDriveId);
      if (raced) return raced;
    }
    throw err;
  }
  await recordExamComparison(user.id, id, telemetry);
  return { id, created: true, metrics, readiness, history, debrief_status: "pending", locale: user.locale };
}
