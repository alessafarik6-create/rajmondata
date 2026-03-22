import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const TERMINAL_JWT_TYP = "terminal_pin";

export function getTerminalSessionSecretKey(): Uint8Array | null {
  const s = process.env.TERMINAL_SESSION_SECRET?.trim();
  if (!s || s.length < 32) {
    console.error(
      "[terminal-session-jwt] TERMINAL_SESSION_SECRET missing or shorter than 32 chars (set in .env)"
    );
    return null;
  }
  return new TextEncoder().encode(s);
}

export async function signTerminalPinSessionToken(
  companyId: string,
  employeeId: string
): Promise<string | null> {
  const key = getTerminalSessionSecretKey();
  if (!key) return null;
  return new SignJWT({
    typ: TERMINAL_JWT_TYP,
    companyId,
    employeeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(employeeId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key);
}

export type TerminalPinJwtPayload = JWTPayload & {
  typ?: string;
  companyId?: string;
  employeeId?: string;
};

export async function verifyTerminalPinSessionToken(
  token: string
): Promise<TerminalPinJwtPayload | null> {
  const key = getTerminalSessionSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.typ !== TERMINAL_JWT_TYP) return null;
    const companyId = typeof payload.companyId === "string" ? payload.companyId : "";
    const employeeId = typeof payload.employeeId === "string" ? payload.employeeId : "";
    if (!companyId || !employeeId) return null;
    return payload as TerminalPinJwtPayload;
  } catch {
    return null;
  }
}
