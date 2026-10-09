/**
 * Demo account with a progress story, built through the real pipeline (ingestDrive + debrief).
 *   npm run seed:demo            create demo@roadwise.app if missing and ingest the story
 *   npm run seed:demo -- --reset delete the demo user's drives first, then reseed
 * Uses DATABASE_URL (local file in dev, Turso when pointed at production) and OPENROUTER_API_KEY
 * if set (otherwise debriefs are the template fallback).
 */
import "./env";
import { readFileSync } from "node:fs";
import { run } from "../lib/db";
import { createUser, findUserByEmail } from "../lib/auth/users";
import { ingestDrive } from "../lib/drives/ingest";
import { parseTelemetry } from "../lib/telemetry/schema";
import { generateAndStoreDebrief } from "../lib/instructor/store";
import { createLlmClient } from "../lib/instructor/llm";
import { locales } from "../lib/i18n/config";

export const DEMO_EMAIL = "demo@roadwise.app";
export const DEMO_PASSWORD = "roadwise-demo-2026";

/** Story order: rough start, an exam fail, nervous drive, then steady improvement to an exam pass. */
const STORY = ["speeder", "red_light_runner", "mixed_exam_fail", "nervous", "progress_series_1", "progress_series_2", "progress_series_3"];

async function main() {
  const reset = process.argv.includes("--reset");
  const user =
    (await findUserByEmail(DEMO_EMAIL)) ??
    (await createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: "Demo Student", locale: "en" }));
  if (reset) await run("DELETE FROM drives WHERE user_id = ?", [user.id]);

  const client = createLlmClient();
  console.log(`demo user ${DEMO_EMAIL} (${user.id}); debriefs via ${client ? client.model : "template fallback (no OPENROUTER_API_KEY)"}`);

  const today = new Date();
  for (const [i, name] of STORY.entries()) {
    const parsed = parseTelemetry(JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8")));
    if (!parsed.ok) throw new Error(`${name}: ${JSON.stringify(parsed.issues)}`);
    const t = parsed.data;
    // one drive per day, ending yesterday, 13:00 UTC (17:00 Baku)
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (STORY.length - i), 13, 0, 0));
    t.drive.started_at = day.toISOString();
    const r = await ingestDrive(user, t, { source: "fixture" });
    const extraLocales = i >= STORY.length - 2 ? locales.filter((l) => l !== user.locale) : [];
    if (r.created) {
      await generateAndStoreDebrief(r.id, user.locale, client);
      for (const l of extraLocales) await generateAndStoreDebrief(r.id, l, client);
    }
    console.log(
      `${r.created ? "added " : "exists"} ${name.padEnd(18)} ${t.drive.started_at.slice(0, 10)}  readiness ${String(r.readiness.score).padStart(3)} ${r.readiness.band}`,
    );
  }
  console.log(`\nLog in at /en/login with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
