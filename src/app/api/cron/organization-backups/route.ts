import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { runScheduledOrganizationBackupsAdmin } from "@/lib/organization-backup/cron-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Automatické zálohy organizací + retention purge.
 * GET /api/cron/organization-backups?secret=… (CRON_SECRET)
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
    const result = await runScheduledOrganizationBackupsAdmin(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron organization-backups]", e);
    return NextResponse.json({ ok: false, error: "Cron selhal." }, { status: 500 });
  }
}
