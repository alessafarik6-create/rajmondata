import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import {
  COMPANIES_COLLECTION,
  PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION,
} from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ ok: false, error: "Server" }, { status: 503 });
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const caller = await verifyBearerAndLoadCaller(auth, db, token);
  if (!caller) return NextResponse.json({ ok: false, error: "Neautorizováno" }, { status: 401 });
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? caller.companyId).trim();
  if (caller.companyId !== companyId) {
    return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
  }
  const now = Timestamp.now();
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION)
    .orderBy("deliveredAt", "desc")
    .limit(30)
    .get();
  const items = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as Record<string, unknown> & { id: string }))
    .filter((row) => {
      if (row.hiddenFromDashboard === true || row.status === "hidden") return false;
      if (row.status === "expired") return false;
      const end = row.endAt as { toMillis?: () => number } | undefined;
      if (end?.toMillis && end.toMillis() < now.toMillis()) return false;
      return row.status === "active" || !row.status;
    });
  return NextResponse.json({ ok: true, campaigns: items });
}
