import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "superadmin_session";
const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPERADMIN_JWT_SECRET || "superadmin-secret-change-in-production"
);
const JWT_ISSUER = "bizforge-superadmin";
const JWT_AUDIENCE = "bizforge-admin";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

export interface SuperadminSession {
  username: string;
  role: string;
}

export async function createSession(payload: SuperadminSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(JWT_SECRET);
}

export async function verifySession(token: string): Promise<SuperadminSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      username: String(payload.username ?? ""),
      role: String(payload.role ?? ""),
    };
  } catch {
    return null;
  }
}

export async function getSessionFromCookie(): Promise<SuperadminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  return verifySession(token);
}

type CookieSetterResponse = Pick<NextResponse, "cookies">;

export async function setSessionCookie(
  tokenOrResponse: string | CookieSetterResponse,
  maybeToken?: string
): Promise<void> {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  };

  if (typeof tokenOrResponse === "string") {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, tokenOrResponse, options);
    return;
  }

  if (!maybeToken) {
    throw new Error("Missing token for setSessionCookie(response, token)");
  }

  tokenOrResponse.cookies.set(COOKIE_NAME, maybeToken, options);
}

export async function clearSessionCookie(response?: CookieSetterResponse): Promise<void> {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };

  if (response) {
    response.cookies.set(COOKIE_NAME, "", options);
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", options);
}

export function getCookieName(): string {
  return COOKIE_NAME;
}