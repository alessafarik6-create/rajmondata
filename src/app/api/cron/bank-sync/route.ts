import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { loadBankConnection } from "@/lib/bank/connection-store";
import { syncBankForOrganization } from "@/lib/bank/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/cron/bank-sync?secret=CRON_SECRET */
export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  const q = request.nextUrl.searchParams.get("secret") ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!secret || (q !== secret && bearer !== secret)) {
    return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
  }

  const companiesSnap = await db.collection(COMPANIES_COLLECTION).limit(200).get();
  let synced = 0;
  let errors = 0;

  for (const companyDoc of companiesSnap.docs) {
    const conn = await loadBankConnection(db, companyDoc.id);
    if (!conn?.encryptedCertificate || conn.status === "disconnected") continue;
    try {
      await syncBankForOrganization(db, companyDoc.id, "cron");
      synced += 1;
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json({ ok: true, synced, errors });
}
