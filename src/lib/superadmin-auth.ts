import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

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
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(JWT_SECRET);
  return token;
}

export async function verifySession(token: string): Promise<SuperadminSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as SuperadminSession;
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

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function getCookieName(): string {
  return COOKIE_NAME;
}
