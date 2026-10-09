import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateDebrief } from "../lib/ai/debrief/instructor.ts";
import { isLocale } from "../lib/i18n/config.ts";
import { parseDriveTelemetry } from "../lib/telemetry/schema.ts";

const [fixture = "red_light_runner", localeArg = "en"] = process.argv.slice(2);
if (!isLocale(localeArg)) {
  console.error("locale must be en, ru or az");
  process.exit(1);
}
const parsed = parseDriveTelemetry(
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", `${fixture}.json`), "utf8")),
);
if (!parsed.ok) {
  console.error(parsed.issues);
  process.exit(1);
}

const messages = JSON.parse(
  readFileSync(join(process.cwd(), "messages", `${localeArg}.json`), "utf8"),
);
const result = await generateDebrief({
  telemetry: parsed.data,
  locale: localeArg,
  dictionary: messages.debrief,
});
console.log(JSON.stringify(result.debrief, null, 2));
console.log(
  JSON.stringify(
    {
      status: result.status,
      model: result.model,
      prompt_version: result.prompt_version,
      attempts: result.attempts,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms: result.latency_ms,
      validation_errors: result.validation_errors,
    },
    null,
    2,
  ),
);
