import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "./lib/auth/cookie";
import { isProtectedPath, loginRedirectUrl } from "./lib/auth/redirects";
import {
  defaultLocale,
  isLocale,
  localeCookie,
  matchAcceptLanguage,
} from "./lib/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const segment = segments[0];

  if (isLocale(segment)) {
    const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
    if (!sessionToken && isProtectedPath(segments)) {
      const url = request.nextUrl.clone();
      const target = loginRedirectUrl(segment, pathname, search);
      const [path, query] = target.split("?");
      url.pathname = path;
      url.search = query ? `?${query}` : "";
      return NextResponse.redirect(url);
    }

    const response = NextResponse.next();
    if (request.cookies.get(localeCookie)?.value !== segment) {
      response.cookies.set(localeCookie, segment, {
        path: "/",
        maxAge: ONE_YEAR,
        sameSite: "lax",
      });
    }
    if (sessionToken) {
      response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    }
    return response;
  }

  const cookieLocale = request.cookies.get(localeCookie)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (matchAcceptLanguage(request.headers.get("accept-language")) ??
      defaultLocale);

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
