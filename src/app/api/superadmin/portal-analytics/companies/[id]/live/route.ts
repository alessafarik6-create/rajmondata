import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { getCompany } from "@/lib/superadmin-companies";
import {
  aggregateUsersByPresence,
  loadActiveStaffSessionsForOrg,
} from "@/lib/analytics-realtime/presence-server";
import { queryPortalLiveEvents } from "@/lib/analytics-realtime/live-events-server";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firebase Admin není k dispozici." }, { status: 503 });
  }

  const { id: organizationId } = await context.params;
  const company = await getCompany(db, organizationId);
  if (!company) {
    return NextResponse.json({ ok: false, error: "Organizace nenalezena." }, { status: 404 });
  }

  try {
    await db.collection(PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION).add({
      action: "VIEW_ORG_LIVE_PRESENCE",
      organizationId,
      superadmin: auth.session.username,
      at: FieldValue.serverTimestamp(),
    });
  } catch {
    /* ignore */
  }

  const sessions = await loadActiveStaffSessionsForOrg(db, organizationId);
  const users = aggregateUsersByPresence(sessions);
  const recentEvents = await queryPortalLiveEvents(db, {
    organizationId,
    limit: 40,
  });

  return NextResponse.json({
    ok: true,
    organizationId,
    name: company.name,
    users,
    sessions,
    recentEvents,
  });
}
