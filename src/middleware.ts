import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SUPERADMIN_COOKIE_NAME } from "@/lib/superadmin-auth-edge";

const ADMIN_PREFIX = "/admin";
const ADMIN_LOGIN = "/admin/login";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(ADMIN_PREFIX)) {
    return NextResponse.next();
  }
  if (pathname === ADMIN_LOGIN) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL(ADMIN_LOGIN, request.url);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifySessionToken(token);
  if (!session) {
    const loginUrl = new URL(ADMIN_LOGIN, request.url);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SUPERADMIN_COOKIE_NAME);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
