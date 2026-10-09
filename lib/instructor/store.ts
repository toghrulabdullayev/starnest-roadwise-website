/** Generates a drive's debrief in a locale and stores it in drive_debriefs. */
import { queryOne, run } from "@/lib/db";
import type { Locale } from "@/lib/i18n/config";
import type { DriveMetrics } from "@/lib/metrics";
import type { Readiness } from "@/lib/readiness";
import type { History } from "@/lib/history";
import type { DriveTelemetry } from "@/lib/telemetry/schema";
import { buildDebriefInput } from "./input";
import { createGeminiClient, type LlmClient } from "./llm";
import { runDebriefPipeline, type PipelineResult } from "./pipeline";

/** A pending debrief older than this is treated as lost (function timed out) and replaced by the fallback. */
export const PENDING_TIMEOUT_S = 90;

export async function markPending(driveId: string, locale: Locale): Promise<void> {
  await run(
    `INSERT INTO drive_debriefs (drive_id, locale, status, created_at) VALUES (?, ?, 'pending', datetime('now'))
     ON CONFLICT (drive_id, locale) DO UPDATE SET status = 'pending', debrief = NULL, validation_errors = NULL,
       attempts = 0, created_at = datetime('now')`,
    [driveId, locale],
  );
}

async function save(driveId: string, locale: Locale, r: PipelineResult): Promise<void> {
  await run(
    `INSERT INTO drive_debriefs (drive_id, locale, status, debrief, model, prompt_version, input_tokens, output_tokens, latency_ms, attempts, validation_errors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (drive_id, locale) DO UPDATE SET status = excluded.status, debrief = excluded.debrief, model = excluded.model,
       prompt_version = excluded.prompt_version, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
       latency_ms = excluded.latency_ms, attempts = excluded.attempts, validation_errors = excluded.validation_errors`,
    [
      driveId,
      locale,
      r.status,
      JSON.stringify(r.debrief),
      r.model,
      r.prompt_version,
      r.input_tokens,
      r.output_tokens,
      r.latency_ms,
      r.attempts,
      r.validation_errors.length
        ? JSON.stringify({ reasons: r.validation_errors, attempts: r.attempt_log.map(({ raw, ...a }) => ({ ...a, raw: raw.slice(0, 4000) })) })
        : null,
    ],
  );
}

export async function loadDebriefInput(driveId: string, locale: Locale) {
  const row = await queryOne<{ telemetry: string; metrics: string; readiness: string; history: string | null }>(
    "SELECT telemetry, metrics, readiness, history FROM drives WHERE id = ?",
    [driveId],
  );
  if (!row) return null;
  return buildDebriefInput({
    telemetry: JSON.parse(row.telemetry) as DriveTelemetry,
    metrics: JSON.parse(row.metrics) as DriveMetrics,
    readiness: JSON.parse(row.readiness) as Readiness,
    history: row.history ? (JSON.parse(row.history) as History) : null,
    locale,
  });
}

export async function generateAndStoreDebrief(
  driveId: string,
  locale: Locale,
  client: LlmClient | null = createGeminiClient(),
): Promise<PipelineResult | null> {
  const input = await loadDebriefInput(driveId, locale);
  if (!input) return null;
  let result: PipelineResult;
  try {
    result = await runDebriefPipeline(input, locale, client);
  } catch (err) {
    // never leave the drive without a debrief
    result = await runDebriefPipeline(input, locale, null);
    result.validation_errors.unshift(`pipeline error: ${String(err).slice(0, 300)}`);
  }
  await save(driveId, locale, result);
  console.log(
    JSON.stringify({
      evt: "debrief_stored",
      drive_id: driveId,
      locale,
      status: result.status,
      model: result.model,
      prompt_version: result.prompt_version,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms: result.latency_ms,
      attempts: result.attempts,
    }),
  );
  return result;
}

/** If a pending debrief has been stuck past the timeout, replace it with the fallback now. */
export async function resolveStalePending(driveId: string, locale: Locale): Promise<boolean> {
  const row = await queryOne<{ status: string; age_s: number }>(
    "SELECT status, (julianday('now') - julianday(created_at)) * 86400 AS age_s FROM drive_debriefs WHERE drive_id = ? AND locale = ?",
    [driveId, locale],
  );
  if (!row || row.status !== "pending" || row.age_s < PENDING_TIMEOUT_S) return false;
  const input = await loadDebriefInput(driveId, locale);
  if (!input) return false;
  const result = await runDebriefPipeline(input, locale, null);
  result.validation_errors.splice(0, result.validation_errors.length, `timed out after ${PENDING_TIMEOUT_S}s while pending`);
  await save(driveId, locale, result);
  return true;
}
