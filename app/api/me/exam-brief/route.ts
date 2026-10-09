import { getRequestUser } from "@/lib/auth/requestUser";
import { buildExamBrief } from "@/lib/exam/adaptive";
import { json, unauthorized } from "@/lib/http";
import { loadFocus } from "@/lib/profile/load";

/** What the next exam should practise; the game builds the route from its own road graph. */
export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  const { focus, drivesCount } = await loadFocus(caller.user.id);
  return json({ brief: buildExamBrief({ focus, drivesCount }) });
}
