import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const limit = Math.min(100, Number(request.nextUrl.searchParams.get("limit") || 50));
  const snap = await db
    .collection(PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get()
    .catch(async () => db.collection(PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION).limit(limit).get());

  const alerts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));

  return NextResponse.json({ ok: true, alerts });
}
