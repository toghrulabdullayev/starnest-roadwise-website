import type { Dictionary } from "../i18n/getDictionary";
import { RULE_KEYS, type RuleKey } from "../rules/catalog";

/** One practical "how to fix" line per rule, shared with the debrief fallback (messages → instructor.rules). */
export type RuleTips = Record<RuleKey, string>;

export function ruleTips(dict: Dictionary): RuleTips {
  return Object.fromEntries(RULE_KEYS.map((k) => [k, dict.instructor.rules[k].how])) as RuleTips;
}
