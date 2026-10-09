/**
 * Grounding validator (roadwise-ai-instructor §6). A debrief is rejected if:
 *  1. it is not JSON matching the schema
 *  2. it cites an event id that is not in the input events
 *  3. an issue's rule is not a catalog key present in the input rules
 *  4. an issue cites an event that is not a failed check (or of another rule); a strength cites a non-pass
 *  5. its free text contains a number that does not appear in the serialised input (mm:ss allowed if present)
 *  6. a major failed check in the input is not covered by any issue
 *  7. its free text shows an internal identifier (snake_case key, or a band/component/rule key
 *     as a Latin word in Russian or Azerbaijani text) instead of the label from the input
 */
import { debriefSchema, type Debrief } from "@/lib/prompts/debrief";
import { isRuleKey } from "@/lib/rules/catalog";
import { internalKeys } from "@/lib/ai/style";
import type { Locale } from "@/lib/i18n/config";
import type { DebriefInput } from "./input";

export type GroundingCheck =
  | "schema"
  | "unknown_event"
  | "unknown_rule"
  | "wrong_event_kind"
  | "invented_number"
  | "uncovered_major"
  | "internal_key";

export interface GroundingError {
  check: GroundingCheck;
  message: string;
}

export type GroundingResult = { ok: true; debrief: Debrief } | { ok: false; errors: GroundingError[]; debrief: Debrief | null };

/** Normalise a numeric token: "1,5" → "1.5", "07" → "7", "84.0" → "84". */
function normNumber(tok: string): string {
  const n = Number(tok.replace(",", "."));
  return Number.isFinite(n) ? String(n) : tok;
}
function normTime(tok: string): string {
  const [m, s] = tok.split(":");
  return `${Number(m)}:${s}`;
}

const TIME_RE = /\b\d{1,2}:\d{2}\b/g;
const NUM_RE = /\d+(?:[.,]\d+)?/g;
/** Event ids like e12 carry digits that are not numbers. */
const EVENT_ID_RE = /\be\d+\b/gi;

export function allowedNumbers(input: DebriefInput): { numbers: Set<string>; times: Set<string> } {
  const serialised = JSON.stringify(input);
  const times = new Set((serialised.match(TIME_RE) ?? []).map(normTime));
  const numbers = new Set<string>();
  for (const tok of serialised.replace(TIME_RE, " ").replace(EVENT_ID_RE, " ").match(NUM_RE) ?? []) {
    numbers.add(normNumber(tok));
    // allow the integer part / rounded forms of decimals that appear in the input (e.g. 22.9 → 23)
    const n = Number(tok);
    if (!Number.isInteger(n)) numbers.add(String(Math.round(n)));
  }
  return { numbers, times };
}

export function numbersInText(text: string): { numbers: string[]; times: string[] } {
  const times = (text.match(TIME_RE) ?? []).map(normTime);
  const rest = text.replace(TIME_RE, " ").replace(EVENT_ID_RE, " ");
  return { numbers: (rest.match(NUM_RE) ?? []).map(normNumber), times };
}

function freeTexts(d: Debrief): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [{ where: "summary", text: d.summary }];
  d.strengths.forEach((s, i) => out.push({ where: `strengths[${i}].text`, text: s.text }));
  d.issues.forEach((s, i) => {
    out.push({ where: `issues[${i}].title`, text: s.title });
    out.push({ where: `issues[${i}].why_it_matters`, text: s.why_it_matters });
    out.push({ where: `issues[${i}].how_to_fix`, text: s.how_to_fix });
  });
  d.progress?.improved.forEach((t, i) => out.push({ where: `progress.improved[${i}]`, text: t }));
  d.progress?.worse.forEach((t, i) => out.push({ where: `progress.worse[${i}]`, text: t }));
  out.push({ where: "next_drive.focus", text: d.next_drive.focus });
  d.next_drive.drills.forEach((t, i) => out.push({ where: `next_drive.drills[${i}]`, text: t }));
  out.push({ where: "readiness_comment", text: d.readiness_comment });
  return out;
}

export function validateDebrief(raw: string, input: DebriefInput, locale: Locale = "en"): GroundingResult {
  // 1. JSON + schema
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, debrief: null, errors: [{ check: "schema", message: "Output is not valid JSON." }] };
  }
  const parsed = debriefSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      debrief: null,
      errors: parsed.error.issues.slice(0, 10).map((i) => ({
        check: "schema" as const,
        message: `Schema: ${i.path.join(".") || "(root)"} ${i.message}.`,
      })),
    };
  }
  const d = parsed.data;
  const errors: GroundingError[] = [];
  const events = new Map(input.events.map((e) => [e.id, e]));
  const inputRules = new Set(input.rules.map((r) => r.key));

  // 2 + 4: event ids exist and are of the right kind
  d.issues.forEach((issue, i) => {
    for (const id of issue.event_ids) {
      const e = events.get(id);
      if (!e) errors.push({ check: "unknown_event", message: `issues[${i}] cites event "${id}", which is not in the input events.` });
      else if (e.outcome !== "fail")
        errors.push({ check: "wrong_event_kind", message: `issues[${i}] cites "${id}", which is a passed check, not a failure.` });
      else if (e.rule !== issue.rule)
        errors.push({ check: "wrong_event_kind", message: `issues[${i}] has rule "${issue.rule}" but cites "${id}", a "${e.rule}" event.` });
    }
  });
  d.strengths.forEach((s, i) => {
    for (const id of s.event_ids) {
      const e = events.get(id);
      if (!e) errors.push({ check: "unknown_event", message: `strengths[${i}] cites event "${id}", which is not in the input events.` });
      else if (e.outcome !== "pass")
        errors.push({ check: "wrong_event_kind", message: `strengths[${i}] cites "${id}", which is a failed check, not a pass.` });
    }
  });

  // 3: rule keys
  d.issues.forEach((issue, i) => {
    if (!isRuleKey(issue.rule) || !inputRules.has(issue.rule))
      errors.push({ check: "unknown_rule", message: `issues[${i}] uses rule "${issue.rule}", which is not in the input rules.` });
  });

  // 5: numbers
  const allowed = allowedNumbers(input);
  for (const { where, text } of freeTexts(d)) {
    const found = numbersInText(text);
    for (const n of found.numbers)
      if (!allowed.numbers.has(n)) errors.push({ check: "invented_number", message: `${where} contains the number ${n}, which is not in the input.` });
    for (const t of found.times)
      if (!allowed.times.has(t)) errors.push({ check: "invented_number", message: `${where} contains the time ${t}, which is not in the input.` });
  }

  // 6: every major failed check covered
  const cited = new Set(d.issues.flatMap((i) => i.event_ids));
  for (const e of input.events)
    if (e.outcome === "fail" && e.severity === "major" && !cited.has(e.id))
      errors.push({ check: "uncovered_major", message: `Major failed check "${e.id}" (${e.rule} at ${e.time}) is not covered by any issue.` });

  // 7: no internal identifiers in text the student reads
  for (const { where, text } of freeTexts(d))
    for (const key of internalKeys(text, locale))
      errors.push({ check: "internal_key", message: `${where} contains the internal key "${key}"; write the label from the input instead.` });

  return errors.length ? { ok: false, errors, debrief: d } : { ok: true, debrief: d };
}
