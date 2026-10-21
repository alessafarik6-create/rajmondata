import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session || session.role !== "superadmin") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: true, days: [] });

  const snap = await db
    .collection("platform_product_tour_daily")
    .orderBy("day", "desc")
    .limit(30)
    .get();

  const days = snap.docs.map((d) => {
    const data = d.data() as { day?: string; counts?: Record<string, number> };
    return { day: data.day ?? d.id, counts: data.counts ?? {} };
  });

  return NextResponse.json({ ok: true, days });
}
