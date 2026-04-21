import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { processDueMailDispatchQueue } from "@/lib/email-notifications/process-queue";

export const dynamic = "force-dynamic";

/**
 * Periodické zpracování fronty e-mailů (připomenutí kalendáře).
 * Nastavte CRON_SECRET a volejte např. každých 5–15 minut:
 * GET /api/cron/process-email-queue?secret=...
 */
export async function GET(request: NextRequest) {
  try {
    const secret = String(process.env.CRON_SECRET ?? "").trim();
    const q = request.nextUrl.searchParams.get("secret") ?? "";
    if (!secret || q !== secret) {
      return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
    }

    const result = await processDueMailDispatchQueue(db, 40);
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
