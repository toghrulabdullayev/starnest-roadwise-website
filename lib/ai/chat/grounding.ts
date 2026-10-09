import { ungroundedNumbers } from "../numbers.ts";
import type { ChatInput } from "./input";
import { chatReplySchema, type ChatReply } from "./schema.ts";

export type ChatValidation =
  | { ok: true; reply: ChatReply }
  | { ok: false; errors: string[] };

export function validateChatReply(raw: string, input: ChatInput): ChatValidation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["output is not valid JSON"] };
  }
  const parsed = chatReplySchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `schema: ${i.path.join(".") || "(root)"} ${i.message}`,
      ),
    };
  }
  const reply = parsed.data;
  const errors: string[] = [];

  if (input.mode === "exam") {
    if (reply.kind === "answer") errors.push('kind "answer" is not allowed during an exam');
    if (reply.rules.length > 0) errors.push("rules must be empty during an exam");
    if (reply.kind === "directions" && !input.snapshot.next_instruction) {
      errors.push("directions are not available because there is no next_instruction");
    }
  } else if (reply.kind !== "answer") {
    errors.push('kind must be "answer" during a free drive');
  }

  const known = new Set(input.rules.map((r) => r.key));
  for (const rule of reply.rules) {
    if (!known.has(rule)) errors.push(`rule "${rule}" is not in the input`);
  }

  for (const n of ungroundedNumbers([reply.answer], JSON.stringify(input))) {
    errors.push(`number "${n}" does not appear in the input`);
  }

  return errors.length === 0 ? { ok: true, reply } : { ok: false, errors };
}
