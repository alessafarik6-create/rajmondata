import { NextResponse } from "next/server";
import { getSessionFromCookie, type SuperadminSession } from "@/lib/superadmin-auth";

export async function requireSuperadminSession(): Promise<
  { session: SuperadminSession } | { response: NextResponse }
> {
  const session = await getSessionFromCookie();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "superadmin") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}
