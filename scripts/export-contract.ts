import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { driveTelemetrySchema } from "../lib/telemetry/schema.ts";

const jsonSchema = z.toJSONSchema(driveTelemetrySchema, { io: "input" });
const out = join(process.cwd(), "contracts", "roadwise.drive.v1.schema.json");
writeFileSync(out, JSON.stringify(jsonSchema, null, 2) + "\n");
console.log(`wrote ${out}`);
