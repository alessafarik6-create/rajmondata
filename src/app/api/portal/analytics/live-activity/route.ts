import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { appendPortalLiveEvent } from "@/lib/analytics-realtime/live-events-server";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { portalAnalyticsUserHash } from "@/lib/portal-analytics/pseudonym";

export const dynamic = "force-dynamic";

/** Auditní událost z portálu (navazuje na activityLogs, bez citlivých dat). */
export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const callerSnap = await auth.db.collection("users").doc(auth.caller.uid).get();
  const callerData = callerSnap.data() as Record<string, unknown> | undefined;
  if (callerData?.portalAnalyticsOptIn === false) {
    return NextResponse.json({ ok: true, skipped: "opt_out" });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const organizationId = auth.caller.companyId;
  if (String(body.companyId ?? organizationId).trim() !== organizationId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const userHash = portalAnalyticsUserHash(auth.caller.uid, organizationId);
  const rl = await checkFirestoreRateLimit(auth.db, `live_activity:${userHash}`, {
    limit: 120,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: true, skipped: "rate_limit" });
  }

  const actionType = String(body.actionType ?? "action").slice(0, 80);
  const actionLabel = String(body.actionLabel ?? actionType).slice(0, 300);
  const entityType = String(body.entityType ?? "").slice(0, 80) || null;
  const entityId = String(body.entityId ?? "").slice(0, 120) || null;
  const entityName = String(body.entityName ?? "").slice(0, 300) || null;
  const sourceModule = String(body.sourceModule ?? "").slice(0, 64) || null;
  const route = String(body.route ?? "").slice(0, 500) || null;

  const displayName =
    String(callerData?.displayName ?? "").trim() ||
    String(callerData?.email ?? "").split("@")[0] ||
    "Uživatel";

  let orgName: string | null = null;
  try {
    const orgSnap = await auth.db.collection("společnosti").doc(organizationId).get();
    orgName = String(orgSnap.data()?.name ?? orgSnap.data()?.companyName ?? "").trim() || null;
  } catch {
    /* ignore */
  }

  await appendPortalLiveEvent(auth.db, {
    organizationId,
    organizationName: orgName,
    userId: auth.caller.uid,
    userDisplayName: displayName,
    userEmail: typeof callerData?.email === "string" ? callerData.email : null,
    event: actionType.startsWith("auth.") ? actionType.replace("auth.", "") : "action_clicked",
    moduleId: sourceModule,
    actionLabel,
    entityType,
    entityId,
    entityName,
    route,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
  });

  return NextResponse.json({ ok: true });
}
