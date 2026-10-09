import "server-only";
import { bearerToken, validateGameToken } from "./gameToken";
import { getCurrentUser } from "./currentUser";
import type { User } from "./users";

/** Game (Bearer rw_…) or website (session cookie) caller. */
export async function getRequestUser(req: Request): Promise<{ user: User; via: "bearer" | "session" } | null> {
  if (bearerToken(req)) {
    const user = await validateGameToken(bearerToken(req));
    return user ? { user, via: "bearer" } : null;
  }
  const user = await getCurrentUser();
  return user ? { user, via: "session" } : null;
}
