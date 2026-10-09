import { z } from "zod";
import { ruleKeys } from "../../rules/catalog.ts";

const eventIds = z.array(z.string().min(1)).min(1).max(10);

export const debriefSchema = z.object({
  summary: z.string().min(1).max(600),
  strengths: z
    .array(z.object({ text: z.string().min(1).max(300), event_ids: eventIds }))
    .max(4),
  issues: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        severity: z.enum(["major", "minor"]),
        rule: z.enum(ruleKeys),
        event_ids: eventIds,
        why_it_matters: z.string().min(1).max(400),
        how_to_fix: z.string().min(1).max(400),
      }),
    )
    .max(6),
  progress: z
    .object({
      improved: z.array(z.string().max(200)).max(5),
      worse: z.array(z.string().max(200)).max(5),
    })
    .nullable(),
  next_drive: z.object({
    focus: z.string().min(1).max(300),
    mode: z.enum(["free", "exam"]),
    drills: z.array(z.string().min(1).max(200)).max(5),
  }),
});

export type Debrief = z.infer<typeof debriefSchema>;

export function debriefJsonSchema(): unknown {
  const schema = z.toJSONSchema(debriefSchema, { io: "output" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}
