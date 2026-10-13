import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { queryPortalLiveEvents } from "@/lib/analytics-realtime/live-events-server";
import { PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firebase Admin není k dispozici." }, { status: 503 });
  }

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(150, Math.max(1, Number(sp.get("limit") ?? 50)));
  const organizationId = String(sp.get("organizationId") ?? "").trim() || undefined;
  const userId = String(sp.get("userId") ?? "").trim() || undefined;
  const event = String(sp.get("event") ?? "").trim() || undefined;
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  const from = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? new Date(fromRaw) : undefined;
  const to = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : undefined;

  try {
    await db.collection(PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION).add({
      action: "VIEW_LIVE_ACTIVITY_FEED",
      superadmin: auth.session.username,
      organizationId: organizationId ?? null,
      at: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit volitelný */
  }

  const events = await queryPortalLiveEvents(db, {
    limit,
    organizationId,
    userId,
    event,
    from,
    to,
  });

  return NextResponse.json({ ok: true, events });
}
