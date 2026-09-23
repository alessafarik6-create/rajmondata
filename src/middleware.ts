import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  verifySessionToken,
  SUPERADMIN_COOKIE_NAME,
} from "@/lib/superadmin-auth-edge";

const ADMIN_PREFIX = "/admin";
const ADMIN_LOGIN = "/admin/login";

/** Cesty, které se nesmí indexovat (doplňuje metadata v layoutech). */
const NOINDEX_PATH_PREFIXES = [
  "/portal",
  "/admin",
  "/api",
  "/login",
  "/register",
  "/attendance-login",
  "/reset-password",
];

function shouldNoIndex(pathname: string): boolean {
  return NOINDEX_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function withNoIndexHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (host.toLowerCase().startsWith("www.")) {
    const url = request.nextUrl.clone();
    url.host = host.slice(4);
    return NextResponse.redirect(url, 308);
  }

  const { pathname } = request.nextUrl;

  if (shouldNoIndex(pathname)) {
    if (!pathname.startsWith(ADMIN_PREFIX) || pathname === ADMIN_LOGIN) {
      return withNoIndexHeaders(NextResponse.next());
    }
  }

  if (!pathname.startsWith(ADMIN_PREFIX)) {
    return NextResponse.next();
  }

  if (pathname === ADMIN_LOGIN) {
    return withNoIndexHeaders(NextResponse.next());
  }

  const token = request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value;

  if (!token) {
    const loginUrl = new URL(ADMIN_LOGIN, request.url);
    return withNoIndexHeaders(NextResponse.redirect(loginUrl));
  }

  const session = await verifySessionToken(token);

  if (!session) {
    const loginUrl = new URL(ADMIN_LOGIN, request.url);
    const res = withNoIndexHeaders(NextResponse.redirect(loginUrl));
    res.cookies.delete(SUPERADMIN_COOKIE_NAME);
    return res;
  }

  return withNoIndexHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|wasm|js|css)$).*)",
  ],
};
