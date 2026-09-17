import { createHash } from "crypto";

const SALT = process.env.SECURITY_IP_HASH_SALT || process.env.SUPERADMIN_JWT_SECRET || "change-me";

/** Jednosměrný hash IP — nelze zpětně dohledat osobu. */
export function hashIp(ip: string): string {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return "unknown";
  return createHash("sha256").update(`${SALT}:${normalized}`).digest("hex").slice(0, 32);
}

export function clientIpFromHeaders(headers: Headers): string {
  const xf = headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "";
  return headers.get("x-real-ip")?.trim() || "";
}
