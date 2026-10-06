import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveProductionTaskByPublicToken } from "@/lib/production-qr/resolve-public-token";
import { isVisibleInAttendanceTerminal } from "@/lib/employee-organization";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Server není k dispozici." }, { status: 503 });
  }
  const { token } = await ctx.params;
  const resolved = await resolveProductionTaskByPublicToken(db, token);
  if (!resolved) {
    return NextResponse.json({ error: "Neplatný QR kód." }, { status: 404 });
  }

  const empSnap = await db
    .collection("companies")
    .doc(resolved.companyId)
    .collection("employees")
    .get();

  const employees = empSnap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      if (data.isActive === false) return null;
      if (!isVisibleInAttendanceTerminal(data)) return null;
      return {
        id: d.id,
        firstName: String(data.firstName ?? ""),
        lastName: String(data.lastName ?? ""),
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, employees });
}
