import { z } from "zod";
import { RULE_KEYS } from "../../rules/catalog";

export const planSchema = z.object({
  summary: z.string().min(1).max(400),
  priorities: z
    .array(
      z.object({
        rule: z.enum(RULE_KEYS),
        why: z.string().min(1).max(300),
        practice: z.string().min(1).max(300),
      }),
    )
    .max(5),
});

export type LearningPlan = z.infer<typeof planSchema>;

export function planJsonSchema(): unknown {
  const schema = z.toJSONSchema(planSchema, { io: "output" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}
