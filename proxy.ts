import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  defaultLocale,
  isLocale,
  localeCookie,
  matchAcceptLanguage,
} from "./lib/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segment = pathname.split("/")[1];

  if (isLocale(segment)) {
    const response = NextResponse.next();
    if (request.cookies.get(localeCookie)?.value !== segment) {
      response.cookies.set(localeCookie, segment, {
        path: "/",
        maxAge: ONE_YEAR,
        sameSite: "lax",
      });
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
