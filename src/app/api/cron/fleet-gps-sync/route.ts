import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { loadSatelitniOAuthTokens } from "@/lib/integrations/satelitni-sledovani/store";
import { syncSatelitniFleetForOrganization } from "@/lib/integrations/satelitni-sledovani/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/fleet-gps-sync?secret=CRON_SECRET
 * &mode=positions|catalog|full (default positions)
 */
export async function GET(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  const q = request.nextUrl.searchParams.get("secret") ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!secret || (q !== secret && bearer !== secret)) {
    return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
  }

  const modeParam = String(request.nextUrl.searchParams.get("mode") ?? "positions").trim();
  const mode =
    modeParam === "catalog" || modeParam === "full" || modeParam === "positions" ? modeParam : "positions";

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
  }

  const companiesSnap = await db.collection(COMPANIES_COLLECTION).limit(300).get();
  let synced = 0;
  let errors = 0;

  for (const companyDoc of companiesSnap.docs) {
    const tokens = await loadSatelitniOAuthTokens(db, companyDoc.id);
    if (!tokens) continue;
    try {
      await syncSatelitniFleetForOrganization(db, companyDoc.id, mode);
      synced += 1;
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json({ ok: true, mode, synced, errors });
}
