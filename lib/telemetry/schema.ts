/**
 * Contract B — drive telemetry v1 (roadwise-platform §8).
 * Changing this contract means bumping the schema version and updating
 * fixtures, contracts/*.schema.json and docs/GAME_INTEGRATION.md together.
 */
import { z } from "zod";
import { RULE_KEYS } from "@/lib/rules/catalog";

export const SCHEMA_ID = "roadwise.drive.v1";

export const SAMPLE_FIELDS = ["t", "x", "z", "speed_kmh", "limit_kmh", "throttle", "brake", "steer", "handbrake"] as const;
export type SampleField = (typeof SAMPLE_FIELDS)[number];
export type Sample = Record<SampleField, number>;

const finite = z.number().finite();
const nonNeg = finite.min(0);

export const examSchema = z.object({
  passed: z.boolean(),
  minor_faults: z.number().int().min(0),
  major_faults: z.number().int().min(0),
  checkpoints_reached: z.number().int().min(0),
  checkpoints_total: z.number().int().min(0),
});

const eventBase = {
  id: z.string().min(1).max(64),
  t: nonNeg,
};

export const ruleCheckEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("rule_check"),
    rule: z.enum(RULE_KEYS),
    outcome: z.enum(["pass", "fail"]),
    severity: z.enum(["major", "minor"]).optional(),
    fine_azn: nonNeg.optional(),
    x: finite,
    z: finite,
    street: z.string().max(200).optional(),
    detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.outcome === "fail") {
      if (!e.severity) ctx.addIssue({ code: "custom", path: ["severity"], message: "required when outcome is fail" });
      if (e.fine_azn === undefined)
        ctx.addIssue({ code: "custom", path: ["fine_azn"], message: "required when outcome is fail" });
    }
  });

export const checkpointEventSchema = z.object({
  ...eventBase,
  type: z.literal("checkpoint"),
  index: z.number().int().min(0),
});

export const eventSchema = z.discriminatedUnion("type", [ruleCheckEventSchema, checkpointEventSchema]);

export const driveTelemetrySchema = z
  .object({
    schema: z.literal(SCHEMA_ID),
    client: z.object({ name: z.string().min(1).max(64), version: z.string().min(1).max(32) }),
    drive: z.object({
      client_drive_id: z.guid(),
      mode: z.enum(["free", "exam"]),
      district: z.string().max(64).nullable().optional(),
      route_id: z.string().max(64).nullable().optional(),
      car_type: z.string().max(32).nullable().optional(),
      time_of_day: z.enum(["day", "dusk", "night"]),
      started_at: z.iso.datetime({ offset: true }),
      duration_s: nonNeg,
      distance_m: nonNeg,
      exam: examSchema.nullable(),
    }),
    samples: z.object({
      hz: finite.positive().max(60),
      fields: z.array(z.enum(SAMPLE_FIELDS)).min(SAMPLE_FIELDS.length).max(SAMPLE_FIELDS.length),
      rows: z.array(z.array(finite)).max(100_000),
    }),
    events: z.array(eventSchema).max(5_000),
  })
  .superRefine((d, ctx) => {
    // fields: each required field exactly once (order free, rows follow it)
    const seen = new Set<string>();
    d.samples.fields.forEach((f, i) => {
      if (seen.has(f)) ctx.addIssue({ code: "custom", path: ["samples", "fields", i], message: `duplicate field "${f}"` });
      seen.add(f);
    });
    for (const f of SAMPLE_FIELDS)
      if (!seen.has(f)) ctx.addIssue({ code: "custom", path: ["samples", "fields"], message: `missing field "${f}"` });
    // rows match fields
    const width = d.samples.fields.length;
    for (let i = 0; i < d.samples.rows.length; i++) {
      if (d.samples.rows[i].length !== width) {
        ctx.addIssue({
          code: "custom",
          path: ["samples", "rows", i],
          message: `row has ${d.samples.rows[i].length} values, expected ${width}`,
        });
        break;
      }
    }
    // unique event ids
    const ids = new Set<string>();
    d.events.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: ["events", i, "id"], message: `duplicate event id "${e.id}"` });
      ids.add(e.id);
    });
    // exam block iff exam mode
    if (d.drive.mode === "exam" && !d.drive.exam)
      ctx.addIssue({ code: "custom", path: ["drive", "exam"], message: "required in exam mode" });
    if (d.drive.mode === "free" && d.drive.exam)
      ctx.addIssue({ code: "custom", path: ["drive", "exam"], message: "must be null in free mode" });
  });

export type DriveTelemetry = z.infer<typeof driveTelemetrySchema>;
export type DriveEvent = z.infer<typeof eventSchema>;
export type RuleCheckEvent = z.infer<typeof ruleCheckEventSchema>;

export function isRuleCheck(e: DriveEvent): e is RuleCheckEvent {
  return e.type === "rule_check";
}

/** Rows → typed sample objects in canonical field names, regardless of field order. */
export function toSamples(telemetry: Pick<DriveTelemetry, "samples">): Sample[] {
  const idx = SAMPLE_FIELDS.map((f) => telemetry.samples.fields.indexOf(f));
  return telemetry.samples.rows.map((row) => {
    const s = {} as Sample;
    SAMPLE_FIELDS.forEach((f, i) => (s[f] = row[idx[i]]));
    return s;
  });
}

export type TelemetryIssue = { path: string; message: string };

export function parseTelemetry(
  input: unknown,
): { ok: true; data: DriveTelemetry } | { ok: false; issues: TelemetryIssue[] } {
  const r = driveTelemetrySchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    issues: r.error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
