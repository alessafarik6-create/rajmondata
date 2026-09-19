import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { EMAIL_ACCOUNTS_SUBCOLLECTION } from "@/lib/email-mailbox/types";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Synchronizace firemních IMAP schránek (Seznam / obecný IMAP).
 * Volání: GET /api/cron/sync-email-mailboxes?secret=CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  const q = request.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || q !== secret) {
    return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
  }

  const companiesSnap = await db.collection(COMPANIES_COLLECTION).limit(200).get();
  let accounts = 0;
  let imported = 0;
  let errors = 0;

  for (const companyDoc of companiesSnap.docs) {
    const accSnap = await companyDoc.ref.collection(EMAIL_ACCOUNTS_SUBCOLLECTION).limit(50).get();
    for (const acc of accSnap.docs) {
      const data = acc.data() as { status?: string; isActive?: boolean };
      if (data.status !== "connected") continue;
      if (data.isActive === false) continue;
      accounts++;
      const r = await syncEmailAccount(db, companyDoc.id, acc.id, { maxMessages: 25 });
      imported += r.imported;
      if (r.error) errors++;
    }
  }

  return NextResponse.json({ ok: true, accounts, imported, errors });
}
