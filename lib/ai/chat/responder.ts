import type { Locale } from "../../i18n/config";
import type { FocusEntry } from "../../profile/focus.ts";
import type { GenerateJson } from "../gemini.ts";
import { runGrounded } from "../runner.ts";
import { buildFallbackReply, type ChatDictionary } from "./fallback.ts";
import { validateChatReply } from "./grounding.ts";
import { buildChatInput } from "./input.ts";
import { CHAT_PROMPT_VERSION, chatSystemPrompt, chatUserMessage } from "./prompt.ts";
import { chatJsonSchema, chatRequestSchema, type ChatReply } from "./schema.ts";

export const CHAT_MAX_ATTEMPTS = 1;

export type ChatResult = {
  status: "ready" | "fallback";
  reply: ChatReply;
  model: string | null;
  prompt_version: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  attempts: number;
  validation_errors: string[][];
};

export type ChatOutcome =
  | { ok: true; result: ChatResult }
  | { ok: false; error: "invalid_request"; issues: string[] };

export async function answerDrivingQuestion(options: {
  body: unknown;
  locale: Locale;
  focus?: FocusEntry[];
  generate?: GenerateJson;
  configured?: boolean;
  dictionary?: ChatDictionary;
}): Promise<ChatOutcome> {
  const parsed = chatRequestSchema.safeParse(options.body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_request",
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const { locale } = options;
  const input = buildChatInput(parsed.data, locale, options.focus);

  const outcome = await runGrounded<ChatReply>({
    system: chatSystemPrompt(locale, input.mode),
    buildInput: () => chatUserMessage(input),
    schema: chatJsonSchema(),
    validate: (raw) => {
      const checked = validateChatReply(raw, input);
      return checked.ok
        ? { ok: true, value: checked.reply }
        : { ok: false, errors: checked.errors };
    },
    generate: options.generate,
    configured: options.configured,
    maxAttempts: CHAT_MAX_ATTEMPTS,
    temperature: 0.3,
  });

  let reply = outcome.value;
  if (!reply) {
    let dictionary = options.dictionary;
    if (!dictionary) {
      const dict = await (await import("../../i18n/getDictionary")).getDictionary(locale);
      dictionary = { chat: dict.chat, tips: dict.debrief.tips };
    }
    reply = buildFallbackReply(input, locale, dictionary);
  }

  return {
    ok: true,
    result: {
      status: outcome.status,
      reply,
      model: outcome.model,
      prompt_version: CHAT_PROMPT_VERSION,
      input_tokens: outcome.input_tokens,
      output_tokens: outcome.output_tokens,
      latency_ms: outcome.latency_ms,
      attempts: outcome.attempts,
      validation_errors: outcome.validation_errors,
    },
  };
}
