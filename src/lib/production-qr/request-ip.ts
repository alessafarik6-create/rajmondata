import type { NextRequest } from "next/server";

export function getRequestIp(request: NextRequest): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "";
  return request.headers.get("x-real-ip")?.trim() ?? "";
}
