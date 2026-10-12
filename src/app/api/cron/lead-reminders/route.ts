import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { processDueLeadRemindersGlobal } from "@/lib/leads/lead-reminder-fire-server";

export const dynamic = "force-dynamic";

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

    const result = await processDueLeadRemindersGlobal(db, 50);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/lead-reminders]", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
