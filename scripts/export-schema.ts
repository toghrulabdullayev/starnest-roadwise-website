/** Writes contracts/roadwise.drive.v1.schema.json from the zod schema (single source of truth). */
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { driveTelemetrySchema, SCHEMA_ID } from "../lib/telemetry/schema";

const json = z.toJSONSchema(driveTelemetrySchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
const out = {
  $id: `https://roadwise.app/contracts/${SCHEMA_ID}.schema.json`,
  title: SCHEMA_ID,
  description:
    "Roadwise drive telemetry v1. Generated from lib/telemetry/schema.ts. Extra server-side checks not expressible here: " +
    "samples.fields must contain each field exactly once and every row must have fields.length values; event ids unique per drive; " +
    "rule_check with outcome=fail requires severity and fine_azn; drive.exam required in exam mode and null in free mode.",
  ...json,
};
writeFileSync("contracts/roadwise.drive.v1.schema.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote contracts/roadwise.drive.v1.schema.json");
