import type { NextRequest } from "next/server";

/**
 * Vercel Cron posílá `Authorization: Bearer ${CRON_SECRET}`.
 * Ruční spuštění: `?secret=` stejná hodnota.
 */
export function isCronRequestAuthorized(request: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const q = request.nextUrl.searchParams.get("secret") ?? "";
  if (q && q === secret) return true;
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  return false;
}
