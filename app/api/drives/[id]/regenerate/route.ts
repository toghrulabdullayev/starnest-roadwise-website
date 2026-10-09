import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDrive } from "@/lib/drives/queries";
import { json, readJson, sameOrigin, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { generateAndStoreDebrief, markPending } from "@/lib/instructor/store";

export const maxDuration = 60;

/** Website only (session cookie): regenerate the debrief in the viewer's current language. */
export async function POST(req: Request, ctx: RouteContext<"/api/drives/[id]/regenerate">) {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const drive = await getDrive(id, user.id);
  if (!drive) return json({ error: "not_found" }, 404);
  const body = (await readJson(req)) as { locale?: unknown } | null;
  const locale = isLocale(body?.locale) ? body.locale : user.locale;
  await markPending(drive.id, locale);
  after(() => generateAndStoreDebrief(drive.id, locale));
  return json({ status: "pending", locale });
}
