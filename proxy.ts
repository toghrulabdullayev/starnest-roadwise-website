import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, defaultLocale, isLocale, matchAcceptLanguage } from "@/lib/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;
const SESSION_COOKIE = "rw_session";
/** Pages that need an account. Proxy only checks the cookie exists; pages do the real check. */
const PROTECTED = /^\/(en|ru|az)\/(profile|link|drives|quiz)(\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1];

  // No locale in the path: redirect to cookie → Accept-Language → default.
  if (!isLocale(first)) {
    const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookieLocale)
      ? cookieLocale
      : (matchAcceptLanguage(request.headers.get("accept-language")) ?? defaultLocale);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  if (PROTECTED.test(pathname) && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = `/${first}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Remember the language the visitor is reading in. The header lets not-found.tsx (which gets no
  // params) answer in the language of the URL, not of an older cookie.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-locale", first);
  const response = NextResponse.next({ request: { headers: forwarded } });
  if (request.method === "GET" && request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  }
  // Sliding session: keep the cookie alive while the DB session (renewed in validateSession) is.
  // GET only: a Set-Cookie on a server-action POST would make Next re-render the whole page.
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && request.method === "GET") {
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

export const config = {
  // Pages only: skip API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
