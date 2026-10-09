import { ungroundedNumbers } from "../numbers.ts";
import type { PlanInput } from "./input";
import { planSchema, type LearningPlan } from "./schema.ts";

export type PlanValidation =
  | { ok: true; plan: LearningPlan }
  | { ok: false; errors: string[] };

export function validatePlan(raw: string, input: PlanInput): PlanValidation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["output is not valid JSON"] };
  }
  const parsed = planSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".") || "(root)"} ${i.message}`,
      ),
    };
  }
  const plan = parsed.data;
  const errors: string[] = [];

  const expected = new Set(input.focus.map((f) => f.rule));
  const seen = new Set<string>();
  for (const [i, item] of plan.priorities.entries()) {
    if (!expected.has(item.rule)) {
      errors.push(`priorities.${i}.rule "${item.rule}" is not in the input`);
    }
    if (seen.has(item.rule)) {
      errors.push(`priorities.${i}.rule "${item.rule}" appears more than once`);
    }
    seen.add(item.rule);
  }
  for (const rule of expected) {
    if (!seen.has(rule)) errors.push(`rule "${rule}" from the input is missing from priorities`);
  }

  const texts = [plan.summary, ...plan.priorities.flatMap((p) => [p.why, p.practice])];
  for (const n of ungroundedNumbers(texts, JSON.stringify(input))) {
    errors.push(`number "${n}" does not appear in the input`);
  }

  return errors.length === 0 ? { ok: true, plan } : { ok: false, errors };
}
