import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { processExpiredPlatformPaymentGraceAdmin } from "@/lib/platform-invoice-payment-server";

export const dynamic = "force-dynamic";

/**
 * Po uplynutí 48 h od „Zaplatil jsem“ bez potvrzení superadminem deaktivuje účet organizace.
 * GET /api/cron/platform-payment-grace?secret=… (CRON_SECRET)
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
      return NextResponse.json({ ok: false, error: "Firebase není k dispozici." }, { status: 503 });
    }
    const out = await processExpiredPlatformPaymentGraceAdmin(db);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[cron/platform-payment-grace]", e);
    const msg = e instanceof Error ? e.message : "Cron selhal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
