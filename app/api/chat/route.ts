import { forbidden, tooManyRequests } from "@/lib/ai/http";
import { chatLimiter } from "@/lib/ai/chat/rateLimit";
import { answerDrivingQuestion } from "@/lib/ai/chat/responder";
import { getRequestUser } from "@/lib/auth/requestUser";
import { json, readJson, sameOrigin, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { loadFocus } from "@/lib/profile/load";

export const maxDuration = 30;

/**
 * Ask the instructor while driving.
 * Body: { question, snapshot: { mode, speed_kmh, limit_kmh, street?, next_sign?, next_instruction?, recent_faults[] }, locale? }.
 * In an exam only directions (from snapshot.next_instruction) or a refusal come back.
 */
export async function POST(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  if (caller.via === "session" && !sameOrigin(req)) return forbidden();

  const body = (await readJson(req)) as { locale?: unknown; snapshot?: { mode?: unknown } } | null;
  const locale = isLocale(body?.locale) ? body.locale : caller.user.locale;

  const hit = chatLimiter().hit(caller.user.id);
  if (!hit.allowed) return tooManyRequests(hit.retryAfterS * 1000, (await getDictionary(locale)).chat.rateLimited);

  const focus = body?.snapshot?.mode === "exam" ? [] : (await loadFocus(caller.user.id)).focus;
  const outcome = await answerDrivingQuestion({ body, locale, focus });
  if (!outcome.ok) {
    return json({ error: outcome.error, issues: outcome.issues.map((message) => ({ message })) }, 422);
  }

  const { result } = outcome;
  console.log(
    JSON.stringify({
      evt: "chat_answered",
      user_id: caller.user.id,
      locale,
      status: result.status,
      kind: result.reply.kind,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      latency_ms: result.latency_ms,
    }),
  );
  return json({ status: result.status, ...result.reply });
}
