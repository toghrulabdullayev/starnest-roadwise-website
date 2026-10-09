import { getRequestUser } from "@/lib/auth/requestUser";
import { getDebrief, getDrive } from "@/lib/drives/queries";
import { json, siteUrl, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { resolveStalePending } from "@/lib/instructor/store";

export async function GET(req: Request, ctx: RouteContext<"/api/drives/[id]">) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  const { id } = await ctx.params;
  const drive = await getDrive(id, caller.user.id);
  if (!drive) return json({ error: "not_found" }, 404);
  const q = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(q) ? q : caller.user.locale;
  await resolveStalePending(drive.id, locale);
  const { record, available } = await getDebrief(drive.id, locale);
  return json({
    ...drive,
    debrief: record
      ? { status: record.status, locale: record.locale, content: record.debrief, model: record.model, prompt_version: record.prompt_version }
      : null,
    debrief_locales: available,
    url: `${siteUrl()}/${locale}/drives/${drive.id}`,
  });
}
