import type { InStatement } from "@libsql/client";
import type { DriveTelemetry } from "@/lib/telemetry/schema";

/** One row per failed rule check, written in the same batch as the drive. */
export function eventStatements(
  driveId: string,
  userId: string,
  telemetry: DriveTelemetry,
  startedAt: string,
): InStatement[] {
  const statements: InStatement[] = [];
  for (const e of telemetry.events) {
    if (e.type !== "rule_check" || e.outcome !== "fail" || !e.severity) continue;
    statements.push({
      sql: `INSERT INTO drive_events (id, drive_id, user_id, event_id, rule, severity, fine_azn, t_s, x, z, street, detail, mode, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `${driveId}:${e.id}`,
        driveId,
        userId,
        e.id,
        e.rule,
        e.severity,
        e.fine_azn ?? null,
        e.t,
        e.x,
        e.z,
        e.street ?? null,
        e.detail ? JSON.stringify(e.detail) : null,
        telemetry.drive.mode,
        startedAt,
      ],
    });
  }
  return statements;
}
