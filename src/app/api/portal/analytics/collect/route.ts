import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  normalizePortalAnalyticsCollectBody,
  recordPortalAnalyticsEvent,
} from "@/lib/portal-analytics/collect-server";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { portalAnalyticsUserHash } from "@/lib/portal-analytics/pseudonym";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const callerSnap = await auth.db.collection("users").doc(auth.caller.uid).get();
  const callerData = callerSnap.data() as Record<string, unknown> | undefined;
  if (callerData?.portalAnalyticsOptIn === false) {
    return NextResponse.json({ ok: true, skipped: "opt_out" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const parsed = normalizePortalAnalyticsCollectBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Neplatná událost." }, { status: 400 });
  }

  if (parsed.organizationId !== auth.caller.companyId) {
    return NextResponse.json({ error: "Neplatná organizace." }, { status: 403 });
  }

  const userHash = portalAnalyticsUserHash(auth.caller.uid, auth.caller.companyId);
  const rl = await checkFirestoreRateLimit(auth.db, `portal_analytics:${userHash}`, {
    limit: 180,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: true, skipped: "rate_limit" });
  }

  const displayName =
    String(callerData?.displayName ?? "").trim() ||
    String(callerData?.email ?? "").split("@")[0] ||
    "Uživatel";

  void recordPortalAnalyticsEvent(auth.db, {
    ...parsed,
    userId: auth.caller.uid,
    organizationId: auth.caller.companyId,
    userDisplayName: displayName,
    userEmail: typeof callerData?.email === "string" ? callerData.email : null,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
