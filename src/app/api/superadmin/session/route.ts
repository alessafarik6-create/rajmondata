import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ username: session.username, role: session.role });
}
