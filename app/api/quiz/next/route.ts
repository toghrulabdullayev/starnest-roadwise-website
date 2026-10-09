import { getRequestUser } from "@/lib/auth/requestUser";
import { json, unauthorized } from "@/lib/http";
import { isLocale } from "@/lib/i18n/config";
import { loadFocus } from "@/lib/profile/load";
import { startQuiz } from "@/lib/quiz/store";

/** A new 10-question quiz, weighted toward the player's weak rules. Answers are not included. */
export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  const q = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(q) ? q : caller.user.locale;
  const { focus } = await loadFocus(caller.user.id);
  return json(await startQuiz(caller.user.id, locale, focus));
}
