import { z } from "zod";
import { ruleKeys } from "../rules/catalog.ts";

export const TELEMETRY_SCHEMA_ID = "roadwise.drive.v1";

export const SAMPLE_FIELDS = [
  "t",
  "x",
  "z",
  "speed_kmh",
  "limit_kmh",
  "throttle",
  "brake",
  "steer",
  "handbrake",
] as const;

export const MAX_SAMPLE_ROWS = 50_000;
export const MAX_EVENTS = 5_000;

const finite = z.number().finite();

const examResultSchema = z.object({
  passed: z.boolean(),
  minor_faults: z.number().int().min(0),
  major_faults: z.number().int().min(0),
  checkpoints_reached: z.number().int().min(0),
  checkpoints_total: z.number().int().min(0),
});

const driveSchema = z
  .object({
    client_drive_id: z.string().min(1).max(64),
    mode: z.enum(["free", "exam"]),
    district: z.string().min(1).max(64),
    route_id: z.string().min(1).max(64).nullable(),
    car_type: z.string().min(1).max(64),
    time_of_day: z.enum(["day", "dusk", "night"]),
    started_at: z.iso.datetime(),
    duration_s: finite.min(0),
    distance_m: finite.min(0),
    exam: examResultSchema.nullable(),
  })
  .superRefine((drive, ctx) => {
    if (drive.mode === "exam" && drive.exam === null) {
      ctx.addIssue({
        code: "custom",
        path: ["exam"],
        message: "exam result is required when mode is exam",
      });
    }
    if (drive.mode === "free" && drive.exam !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["exam"],
        message: "exam must be null when mode is free",
      });
    }
  });

const samplesSchema = z
  .object({
    hz: finite.positive().max(60),
    fields: z.array(z.string()),
    rows: z.array(z.array(finite)).max(MAX_SAMPLE_ROWS),
  })
  .superRefine((samples, ctx) => {
    const expected: readonly string[] = SAMPLE_FIELDS;
    const matches =
      samples.fields.length === expected.length &&
      samples.fields.every((f, i) => f === expected[i]);
    if (!matches) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: `fields must be exactly [${SAMPLE_FIELDS.join(", ")}]`,
      });
      return;
    }
    samples.rows.forEach((row, i) => {
      if (row.length !== SAMPLE_FIELDS.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `row must have ${SAMPLE_FIELDS.length} values`,
        });
      }
    });
  });

const ruleCheckEventSchema = z
  .object({
    id: z.string().min(1).max(64),
    t: finite.min(0),
    type: z.literal("rule_check"),
    rule: z.enum(ruleKeys),
    outcome: z.enum(["pass", "fail"]),
    severity: z.enum(["minor", "major"]).optional(),
    fine_azn: finite.min(0).optional(),
    x: finite,
    z: finite,
    street: z.string().max(128).optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((event, ctx) => {
    if (event.outcome === "fail") {
      if (event.severity === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["severity"],
          message: "severity is required for a failed check",
        });
      }
      if (event.fine_azn === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["fine_azn"],
          message: "fine_azn is required for a failed check",
        });
      }
    }
  });

const checkpointEventSchema = z.object({
  id: z.string().min(1).max(64),
  t: finite.min(0),
  type: z.literal("checkpoint"),
  index: z.number().int().min(0),
  x: finite.optional(),
  z: finite.optional(),
});

const eventSchema = z.discriminatedUnion("type", [
  ruleCheckEventSchema,
  checkpointEventSchema,
]);

export const driveTelemetrySchema = z
  .object({
    schema: z.literal(TELEMETRY_SCHEMA_ID),
    client: z.object({
      name: z.string().min(1).max(64),
      version: z.string().min(1).max(32),
    }),
    drive: driveSchema,
    samples: samplesSchema,
    events: z.array(eventSchema).max(MAX_EVENTS),
  })
  .superRefine((telemetry, ctx) => {
    const seen = new Set<string>();
    telemetry.events.forEach((event, i) => {
      if (seen.has(event.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "id"],
          message: `duplicate event id ${event.id}`,
        });
      }
      seen.add(event.id);
    });
  });

export type DriveTelemetry = z.infer<typeof driveTelemetrySchema>;
export type DriveEvent = DriveTelemetry["events"][number];
export type RuleCheckEvent = Extract<DriveEvent, { type: "rule_check" }>;
export type CheckpointEvent = Extract<DriveEvent, { type: "checkpoint" }>;

export type TelemetryIssue = { path: string; message: string };

export function parseDriveTelemetry(
  input: unknown,
):
  | { ok: true; data: DriveTelemetry }
  | { ok: false; issues: TelemetryIssue[] } {
  const result = driveTelemetrySchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
