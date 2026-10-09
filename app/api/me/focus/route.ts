import { getRequestUser } from "@/lib/auth/requestUser";
import { json, unauthorized } from "@/lib/http";
import { loadFocus } from "@/lib/profile/load";

/** The player's recurring faults, heaviest first (recent drives count more). */
export async function GET(req: Request) {
  const caller = await getRequestUser(req);
  if (!caller) return unauthorized();
  const { focus, drivesCount } = await loadFocus(caller.user.id);
  return json({ focus, drives_considered: drivesCount });
}
