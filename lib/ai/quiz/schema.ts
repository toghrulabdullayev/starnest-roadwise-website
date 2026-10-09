import { z } from "zod";
import { ruleKeys } from "../../rules/catalog.ts";

export const MAX_GENERATED = 5;

export const generatedQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        rule: z.enum(ruleKeys),
        question: z.string().min(1).max(300),
        options: z.array(z.string().min(1).max(160)).length(4),
        correct_index: z.number().int().min(0).max(3),
        explanation: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(MAX_GENERATED),
});

export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;

export function generatedQuizJsonSchema(): unknown {
  const schema = z.toJSONSchema(generatedQuizSchema, { io: "output" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}
