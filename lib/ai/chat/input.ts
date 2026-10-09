import type { Locale } from "../../i18n/config";
import type { FocusEntry } from "../../profile/focus";
import { RULE_KEYS, RULES, ruleName, type RuleKey } from "../../rules/catalog";
import type { ChatRequest } from "./schema";

export type ChatInput = {
  mode: "free" | "exam";
  question: string;
  snapshot: {
    speed_kmh: number;
    limit_kmh: number | null;
    street?: string;
    next_sign?: string;
    next_instruction?: string;
    recent_faults: { rule: RuleKey; name: string; seconds_ago: number }[];
  };
  weak_rules: string[];
  rules: { key: RuleKey; name: string; severity: string; fine_azn: number | string }[];
};

export function buildChatInput(
  request: ChatRequest,
  locale: Locale,
  focus: FocusEntry[] = [],
): ChatInput {
  const { snapshot } = request;
  return {
    mode: snapshot.mode,
    question: request.question,
    snapshot: {
      speed_kmh: Math.round(snapshot.speed_kmh),
      limit_kmh: snapshot.limit_kmh === null ? null : Math.round(snapshot.limit_kmh),
      ...(snapshot.street ? { street: snapshot.street } : {}),
      ...(snapshot.next_sign ? { next_sign: snapshot.next_sign } : {}),
      ...(snapshot.next_instruction ? { next_instruction: snapshot.next_instruction } : {}),
      recent_faults: snapshot.recent_faults.map((f) => ({
        rule: f.rule,
        name: ruleName(f.rule, locale),
        seconds_ago: Math.round(f.seconds_ago),
      })),
    },
    weak_rules: focus.slice(0, 3).map((f) => ruleName(f.rule, locale)),
    rules: RULE_KEYS.map((key) => ({
      key,
      name: ruleName(key, locale),
      severity: RULES[key].severity ?? "by_band",
      fine_azn: RULES[key].fineAzn ?? "by_band",
    })),
  };
}
