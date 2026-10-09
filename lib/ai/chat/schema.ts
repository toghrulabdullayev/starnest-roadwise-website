import { z } from "zod";
import { RULE_KEYS } from "../../rules/catalog";

export const MAX_QUESTION_LENGTH = 300;

export const snapshotSchema = z.object({
  mode: z.enum(["free", "exam"]),
  speed_kmh: z.number().finite().min(0).max(400),
  limit_kmh: z.number().finite().min(0).max(400).nullable(),
  street: z.string().max(128).optional(),
  next_sign: z.string().max(128).optional(),
  next_instruction: z.string().max(200).optional(),
  recent_faults: z
    .array(
      z.object({
        rule: z.enum(RULE_KEYS),
        seconds_ago: z.number().finite().min(0).max(3600),
      }),
    )
    .max(5),
});

export type DriveSnapshot = z.infer<typeof snapshotSchema>;

export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  snapshot: snapshotSchema,
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatReplySchema = z.object({
  kind: z.enum(["answer", "directions", "refused"]),
  answer: z.string().min(1).max(400),
  rules: z.array(z.enum(RULE_KEYS)).max(3),
});

export type ChatReply = z.infer<typeof chatReplySchema>;

export function chatJsonSchema(): unknown {
  const schema = z.toJSONSchema(chatReplySchema, { io: "output" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}
