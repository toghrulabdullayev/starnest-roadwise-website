import { requireGameUser } from "@/lib/auth/gameToken";
import { getRequestUser } from "@/lib/auth/requestUser";
import { ingestDrive } from "@/lib/drives/ingest";
import { listDrives } from "@/lib/drives/queries";
import { json, siteUrl, unauthorized } from "@/lib/http";
import { parseTelemetry } from "@/lib/telemetry/schema";

/** Gemini runs after the response (see after() in step 4.2); give it room. */
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await requireGameUser(req);
  if (!user) return unauthorized();

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ issues: [{ path: "", message: "upload larger than 4 MB" }] }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ issues: [{ path: "", message: "body is not valid JSON" }] }, 422);
  }
  const parsed = parseTelemetry(body);
  if (!parsed.ok) return json({ issues: parsed.issues }, 422);

  const result = await ingestDrive(user, parsed.data, { source: "game" });
  return json({
    id: result.id,
    created: result.created,
    metrics: result.metrics,
    readiness: result.readiness,
    history: result.history,
    debrief_status: result.debrief_status,
    url: `${siteUrl()}/${user.locale}/drives/${result.id}`,
  });
}

export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  return json({ drives: await listDrives(caller.user.id, 50) });
}
