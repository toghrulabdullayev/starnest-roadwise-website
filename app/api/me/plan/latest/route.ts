import { getRequestUser } from "@/lib/auth/requestUser";
import { json, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { latestPlan } from "@/lib/learning/plans";

/** The most recent plan, optionally for one locale (?locale=). 404 when none exists yet. */
export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  const q = new URL(req.url).searchParams.get("locale");
  const plan = await latestPlan(caller.user.id, isLocale(q) ? q : undefined);
  if (!plan) return json({ error: "not_found" }, 404);
  return json(plan);
}
