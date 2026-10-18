import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { drainMailDispatchQueue } from "@/lib/email-notifications/process-queue";
import { isCronRequestAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron: Authorization Bearer CRON_SECRET (viz vercel.json).
 * Ručně: GET /api/cron/process-email-queue?secret=...
 */
export async function GET(request: NextRequest) {
  try {
    if (!isCronRequestAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
    }

    const result = await drainMailDispatchQueue(db, { maxRounds: 10, batchSize: 30 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/process-email-queue] unhandled", err);
    return NextResponse.json(
      { ok: false, error: msg || "Zpracování fronty selhalo." },
      { status: 500 }
    );
  }
}
