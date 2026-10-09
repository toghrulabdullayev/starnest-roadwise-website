import type { DebriefInput } from "./input";
import { debriefSchema, type Debrief } from "./schema.ts";

const NUMBER = /\d+(?:[.,]\d+)?/g;

function normalizeNumber(token: string): string {
  return token.replace(",", ".").replace(/^0+(?=\d)/, "");
}

function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(normalizeNumber);
}

function freeTexts(d: Debrief): string[] {
  return [
    d.summary,
    ...d.strengths.map((s) => s.text),
    ...d.issues.flatMap((i) => [i.title, i.why_it_matters, i.how_to_fix]),
    ...(d.progress ? [...d.progress.improved, ...d.progress.worse] : []),
    d.next_drive.focus,
    ...d.next_drive.drills,
  ];
}

export type GroundingResult =
  | { ok: true; debrief: Debrief }
  | { ok: false; errors: string[] };

export function validateDebrief(
  raw: string,
  input: DebriefInput,
): GroundingResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["output is not valid JSON"] };
  }

  const parsed = debriefSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".") || "(root)"} ${i.message}`,
      ),
    };
  }
  const debrief = parsed.data;
  const errors: string[] = [];

  const byId = new Map(input.events.map((e) => [e.id, e]));
  const ruleKeysInInput = new Set(input.rules.map((r) => r.key));

  debrief.issues.forEach((issue, i) => {
    if (!ruleKeysInInput.has(issue.rule)) {
      errors.push(`issues.${i}.rule "${issue.rule}" is not a rule present in the input`);
    }
    for (const id of issue.event_ids) {
      const event = byId.get(id);
      if (!event) errors.push(`issues.${i} cites unknown event id "${id}"`);
      else if (event.outcome !== "fail") {
        errors.push(`issues.${i} cites event "${id}" which is not a failed check`);
      }
    }
  });

  debrief.strengths.forEach((strength, i) => {
    for (const id of strength.event_ids) {
      const event = byId.get(id);
      if (!event) errors.push(`strengths.${i} cites unknown event id "${id}"`);
      else if (event.outcome !== "pass") {
        errors.push(`strengths.${i} cites event "${id}" which is not a passed check`);
      }
    }
  });

  const allowed = new Set(numbersIn(JSON.stringify(input)));
  const invented = new Set<string>();
  for (const text of freeTexts(debrief)) {
    for (const n of numbersIn(text)) {
      if (!allowed.has(n)) invented.add(n);
    }
  }
  for (const n of invented) {
    errors.push(`number "${n}" does not appear in the input`);
  }

  const covered = new Set(debrief.issues.flatMap((i) => i.event_ids));
  for (const event of input.events) {
    if (event.outcome === "fail" && event.severity === "major" && !covered.has(event.id)) {
      errors.push(`major failed check "${event.id}" (${event.rule}) is not covered by any issue`);
    }
  }

  return errors.length === 0
    ? { ok: true, debrief }
    : { ok: false, errors };
}
