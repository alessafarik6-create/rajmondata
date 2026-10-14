import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { loadBankConnection } from "@/lib/bank/connection-store";
import { syncBankForOrganization } from "@/lib/bank/sync-service";
import { automationSettingsFromConnection, computeNextScheduledSyncAt } from "@/lib/bank/automation-settings";
import { bankConnectionsCol } from "@/lib/bank/collections";
import { appendBankAutomationLog } from "@/lib/bank/automation-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/cron/bank-sync?secret=CRON_SECRET — každých 5 hodin (Vercel cron). */
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
  let skipped = 0;
  let errors = 0;

  for (const companyDoc of companiesSnap.docs) {
    const organizationId = companyDoc.id;
    const conn = await loadBankConnection(db, organizationId);
    if (!conn?.encryptedCertificate || conn.status === "disconnected") continue;

    const settings = automationSettingsFromConnection(conn);
    if (!settings.autoSyncEnabled) {
      skipped += 1;
      continue;
    }

    try {
      const result = await syncBankForOrganization(db, organizationId, "cron");
      synced += 1;
      await appendBankAutomationLog(db, {
        organizationId,
        kind: "sync",
        success: true,
        message: `Synchronizace OK — ${result.imported} nových transakcí, ${result.autoMatched ?? 0} auto spárování.`,
        metadata: {
          imported: result.imported,
          updated: result.updated,
          autoMatched: result.autoMatched ?? 0,
        },
      });
    } catch (e) {
      errors += 1;
      const msg = e instanceof Error ? e.message : "Synchronizace selhala.";
      await bankConnectionsCol(db, organizationId).doc(conn.id ?? "raiffeisen").set(
        {
          automationStats: {
            ...(conn.automationStats ?? {}),
            lastAutoSyncError: msg.slice(0, 500),
            nextScheduledSyncAt: computeNextScheduledSyncAt(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await appendBankAutomationLog(db, {
        organizationId,
        kind: "sync",
        success: false,
        message: msg.slice(0, 500),
      });
    }
  }

  return NextResponse.json({ ok: true, synced, skipped, errors });
}
