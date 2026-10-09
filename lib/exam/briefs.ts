import { randomUUID } from "node:crypto";
import { query, queryOne, run } from "@/lib/db";
import { buildExamBrief, type ExamBrief } from "@/lib/exam/adaptive";
import { compareExamWithBrief, type ExamComparison } from "@/lib/profile/compare";
import { faultsFromTelemetry } from "@/lib/profile/focus";
import { loadFocus } from "@/lib/profile/load";
import type { DriveTelemetry } from "@/lib/telemetry/schema";

/** Build the next exam brief from the player's weaknesses and remember it, so the exam can be compared with it later. */
export async function issueExamBrief(userId: string): Promise<{ brief_id: string; brief: ExamBrief }> {
  const { focus, drivesCount } = await loadFocus(userId);
  const brief = buildExamBrief({ focus, drivesCount });
  const id = randomUUID();
  await run("INSERT INTO exam_briefs (id, user_id, brief) VALUES (?, ?, ?)", [id, userId, JSON.stringify(brief)]);
  return { brief_id: id, brief };
}

/** After an exam drive is stored: compare it with the newest unused brief. Never throws; returns null when there is nothing to compare. */
export async function recordExamComparison(
  userId: string,
  driveId: string,
  telemetry: DriveTelemetry,
): Promise<ExamComparison | null> {
  if (telemetry.drive.mode !== "exam") return null;
  try {
    const row = await queryOne<{ id: string; brief: string }>(
      "SELECT id, brief FROM exam_briefs WHERE user_id = ? AND drive_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
      [userId],
    );
    if (!row) return null;
    const brief = JSON.parse(row.brief) as ExamBrief;
    const { focus } = await loadFocus(userId);
    const comparison = compareExamWithBrief({ brief, exam: faultsFromTelemetry(telemetry), nextFocus: focus });
    await run(
      "UPDATE exam_briefs SET drive_id = ?, comparison = ?, compared_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND drive_id IS NULL",
      [driveId, JSON.stringify(comparison), row.id],
    );
    return comparison;
  } catch (err) {
    console.error(JSON.stringify({ evt: "exam_comparison_failed", drive_id: driveId, error: String(err).slice(0, 300) }));
    return null;
  }
}

export async function examComparisonFor(driveId: string): Promise<{ brief: ExamBrief; comparison: ExamComparison } | null> {
  const rows = await query<{ brief: string; comparison: string }>(
    "SELECT brief, comparison FROM exam_briefs WHERE drive_id = ? AND comparison IS NOT NULL LIMIT 1",
    [driveId],
  );
  return rows[0] ? { brief: JSON.parse(rows[0].brief), comparison: JSON.parse(rows[0].comparison) } : null;
}
