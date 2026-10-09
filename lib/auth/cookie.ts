export const SESSION_COOKIE = "rw_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(expires ? { expires } : { maxAge: SESSION_MAX_AGE_S }),
  };
}
