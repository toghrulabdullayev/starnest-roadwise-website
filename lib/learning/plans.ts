import { randomUUID } from "node:crypto";
import { query, queryOne, run } from "@/lib/db";
import type { GenerateJson } from "@/lib/ai/llm";
import { generateLearningPlan } from "@/lib/ai/plan/planner";
import type { LearningPlan } from "@/lib/ai/plan/schema";
import type { Locale } from "@/lib/i18n/config";
import { loadFocus } from "@/lib/profile/load";
import type { FocusEntry } from "@/lib/profile/focus";
import type { RuleKey } from "@/lib/rules/catalog";

export interface StoredPlan {
  id: string;
  locale: Locale;
  status: "ready" | "fallback";
  plan: LearningPlan;
  practice_tags: RuleKey[];
  focus: FocusEntry[];
  created_at: string;
}

interface PlanRow {
  id: string;
  locale: Locale;
  status: "ready" | "fallback";
  plan: string;
  practice_tags: string;
  focus: string;
  created_at: string;
}

function toStored(r: PlanRow): StoredPlan {
  return {
    id: r.id,
    locale: r.locale,
    status: r.status,
    plan: JSON.parse(r.plan),
    practice_tags: JSON.parse(r.practice_tags),
    focus: JSON.parse(r.focus),
    created_at: r.created_at,
  };
}

export async function createPlan(
  userId: string,
  locale: Locale,
  options: { generate?: GenerateJson; configured?: boolean } = {},
): Promise<StoredPlan> {
  const { focus } = await loadFocus(userId);
  const result = await generateLearningPlan({ focus, locale, ...options });
  const id = randomUUID();

  await run(
    `INSERT INTO practice_plans (id, user_id, locale, status, focus, plan, practice_tags, model, prompt_version,
       input_tokens, output_tokens, latency_ms, attempts, validation_errors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      locale,
      result.status,
      JSON.stringify(focus),
      JSON.stringify(result.plan),
      JSON.stringify(result.practice_tags),
      result.model,
      result.prompt_version,
      result.input_tokens,
      result.output_tokens,
      result.latency_ms,
      result.attempts,
      result.validation_errors.length ? JSON.stringify(result.validation_errors) : null,
    ],
  );
  console.log(
    JSON.stringify({
      evt: "plan_stored",
      user_id: userId,
      locale,
      status: result.status,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms: result.latency_ms,
      attempts: result.attempts,
    }),
  );

  const row = await queryOne<PlanRow>("SELECT id, locale, status, plan, practice_tags, focus, created_at FROM practice_plans WHERE id = ?", [id]);
  return toStored(row!);
}

export async function latestPlan(userId: string, locale?: Locale): Promise<StoredPlan | null> {
  const rows = await query<PlanRow>(
    `SELECT id, locale, status, plan, practice_tags, focus, created_at FROM practice_plans
     WHERE user_id = ? ${locale ? "AND locale = ?" : ""} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    locale ? [userId, locale] : [userId],
  );
  return rows[0] ? toStored(rows[0]) : null;
}
