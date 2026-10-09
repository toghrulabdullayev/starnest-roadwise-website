import { query } from "@/lib/db";
import type { DriveFaults } from "@/lib/profile/focus";
import type { RuleKey, Severity } from "@/lib/rules/catalog";

export const FOCUS_WINDOW = 10;

/** The user's latest drives (newest first) with their faults; clean drives are included so recency decay counts them. */
export async function loadDriveFaults(userId: string, limit = FOCUS_WINDOW): Promise<DriveFaults[]> {
  const drives = await query<{ id: string; started_at: string }>(
    "SELECT id, started_at FROM drives WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
    [userId, limit],
  );
  if (drives.length === 0) return [];

  const marks = drives.map(() => "?").join(", ");
  const events = await query<{ drive_id: string; rule: RuleKey; severity: Severity }>(
    `SELECT drive_id, rule, severity FROM drive_events WHERE drive_id IN (${marks}) ORDER BY t_s`,
    drives.map((d) => d.id),
  );

  const byDrive = new Map<string, DriveFaults["faults"]>();
  for (const e of events) {
    const list = byDrive.get(e.drive_id) ?? [];
    list.push({ rule: e.rule, severity: e.severity });
    byDrive.set(e.drive_id, list);
  }
  return drives.map((d) => ({
    drive_id: d.id,
    started_at: d.started_at,
    faults: byDrive.get(d.id) ?? [],
  }));
}
