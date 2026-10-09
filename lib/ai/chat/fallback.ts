import type { Dictionary } from "../../i18n/getDictionary";
import type { RuleTips } from "../tips";
import type { Locale } from "../../i18n/config";
import { ruleName } from "../../rules/catalog";
import type { ChatInput } from "./input";
import type { ChatReply } from "./schema";

export type ChatDictionary = {
  chat: Dictionary["chat"];
  tips: RuleTips;
};

export function buildFallbackReply(
  input: ChatInput,
  locale: Locale,
  dict: ChatDictionary,
): ChatReply {
  if (input.mode === "exam") {
    return { kind: "refused", answer: dict.chat.examRefusal, rules: [] };
  }

  const last = [...input.snapshot.recent_faults].sort(
    (a, b) => a.seconds_ago - b.seconds_ago,
  )[0];
  if (last) {
    return {
      kind: "answer",
      answer: dict.chat.fallbackFault
        .replace("{rule}", ruleName(last.rule, locale))
        .replace("{tip}", dict.tips[last.rule]),
      rules: [last.rule],
    };
  }
  return { kind: "answer", answer: dict.chat.fallbackGeneric, rules: [] };
}
