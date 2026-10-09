import { requireGameUser } from "@/lib/auth/gameToken";
import { json, unauthorized } from "@/lib/http";

export async function GET(req: Request) {
  const user = await requireGameUser(req);
  if (!user) return unauthorized();
  return json({ id: user.id, display_name: user.display_name, locale: user.locale });
}
