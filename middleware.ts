import { NextRequest, NextResponse } from "next/server";
import { languageCookie, languageFromPathname, localizedPath, preferredLanguage } from "./lib/locale";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/" || pathname === "/score-sync") {
    const language = preferredLanguage(request.cookies.get(languageCookie)?.value, request.headers.get("accept-language"));
    const url = request.nextUrl.clone();
    url.pathname = localizedPath(pathname, language);
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Accept-Language, Cookie");
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set("x-site-language", languageFromPathname(pathname) ?? "ko");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/", "/score-sync", "/ko/:path*", "/en/:path*"] };
