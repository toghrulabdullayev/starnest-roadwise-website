import { z } from "zod";
import { forbidden } from "@/lib/ai/http";
import { getRequestUser } from "@/lib/auth/requestUser";
import { json, readJson, sameOrigin, unauthorized } from "@/lib/http";
import { submitQuiz } from "@/lib/quiz/store";

const bodySchema = z.object({
  quiz_id: z.string().min(1).max(64),
  answers: z
    .array(z.object({ question_id: z.string().min(1).max(64), chosen_index: z.number().int().min(0).max(3) }))
    .max(50),
});

/** Score a quiz. Body: { quiz_id, answers: [{ question_id, chosen_index }] }. Each quiz can be answered once. */
export async function POST(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  if (caller.via === "session" && !sameOrigin(req)) return forbidden();

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  }
  const outcome = await submitQuiz(caller.user.id, parsed.data.quiz_id, parsed.data.answers);
  if (!outcome.ok) return json({ error: outcome.error }, outcome.error === "not_found" ? 404 : 409);
  return json(outcome.quiz);
}
