import { jwtVerify, SignJWT } from "jose";

export const SUPERADMIN_COOKIE_NAME = "superadmin_session";

const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPERADMIN_JWT_SECRET || "superadmin-secret-change-in-production"
);
const JWT_ISSUER = "bizforge-superadmin";
const JWT_AUDIENCE = "bizforge-admin";

export interface SuperadminSession {
  username: string;
  role: string;
}

export async function verifySessionToken(token: string): Promise<SuperadminSession | null> {
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
