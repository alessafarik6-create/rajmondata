import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { EMAIL_ACCOUNTS_SUBCOLLECTION } from "@/lib/email-mailbox/types";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import { isEmailSyncStateStale } from "@/lib/email-mailbox/sync-timeout";
import { emailAccountsCol } from "@/lib/email-mailbox/account-store";

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
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const authorized = Boolean(secret && (q === secret || bearer === secret));
  if (!authorized) {
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
      const data = acc.data() as {
        status?: string;
        isActive?: boolean;
        updatedAt?: unknown;
      };
      if (data.isActive === false || data.status === "disconnected") continue;

      const status = String(data.status ?? "");
      const syncable =
        status === "connected" ||
        status === "error" ||
        status === "auth_error" ||
        (status === "syncing" && isEmailSyncStateStale(data.updatedAt));

      if (!syncable) continue;

      if (status === "syncing" && isEmailSyncStateStale(data.updatedAt)) {
        await emailAccountsCol(db, companyDoc.id)
          .doc(acc.id)
          .update({
            status: "error",
            lastError: "Předchozí synchronizace nebyla dokončena (cron).",
            updatedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => undefined);
      }

      accounts++;
      const r = await syncEmailAccount(db, companyDoc.id, acc.id, {
        maxMessages: 40,
        skipAi: true,
      });
      imported += r.imported;
      if (!r.success) errors++;
    }
  }

  return NextResponse.json({ ok: true, accounts, imported, errors });
}
