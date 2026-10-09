import { aiLimiter } from "@/lib/ai/limits";
import { getRequestUser } from "@/lib/auth/requestUser";
import { forbidden, json, readJson, sameOrigin, tooManyRequests, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { createPlan } from "@/lib/learning/plans";

/** One model call (up to two attempts); give it room. */
export const maxDuration = 60;

const limiter = () => aiLimiter("plan", 5, 60_000);

/** Build a new learning plan from the player's current weaknesses. Body (optional): { "locale": "en" | "ru" | "az" }. */
export async function POST(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  if (caller.via === "session" && !sameOrigin(req)) return forbidden();

  const hit = limiter().hit(caller.user.id);
  if (!hit.allowed) return tooManyRequests(hit.retryAfterS * 1000);

  const body = (await readJson(req)) as { locale?: unknown } | null;
  const locale = isLocale(body?.locale) ? body.locale : caller.user.locale;
  const plan = await createPlan(caller.user.id, locale);
  return json(plan);
}
