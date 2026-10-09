import { getRequestUser } from "@/lib/auth/requestUser";
import { issueExamBrief } from "@/lib/exam/briefs";
import { json, unauthorized } from "@/lib/http";

/** What the next exam should practise; the game builds the route from its own road graph. The brief is remembered so the exam can be compared with it. */
export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  return json(await issueExamBrief(caller.user.id));
}
