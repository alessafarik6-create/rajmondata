import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import {
  PLATFORM_SECURITY_DAILY_COLLECTION,
  PLATFORM_SECURITY_INCIDENTS_COLLECTION,
} from "@/lib/firestore-collections";
import { writeSecurityAudit } from "@/lib/security/security-incidents";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const severity = request.nextUrl.searchParams.get("severity");
  const unresolvedOnly = request.nextUrl.searchParams.get("unresolved") === "1";

  const snap = await db.collection(PLATFORM_SECURITY_INCIDENTS_COLLECTION).limit(150).get();
  let items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = (a as { lastActivityAt?: { toMillis?: () => number } }).lastActivityAt?.toMillis?.() ?? 0;
      const tb = (b as { lastActivityAt?: { toMillis?: () => number } }).lastActivityAt?.toMillis?.() ?? 0;
      return tb - ta;
    })
    .slice(0, 80);
  items = items.filter((x) => !(x as { testMode?: boolean }).testMode);
  if (severity && severity !== "all") {
    items = items.filter((x) => (x as { severity?: string }).severity === severity);
  }
  if (unresolvedOnly) {
    items = items.filter((x) => !(x as { resolvedAt?: unknown }).resolvedAt);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dailySnap = await db.collection(PLATFORM_SECURITY_DAILY_COLLECTION).doc(today).get();
  const daily = dailySnap.data() ?? {};

  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dailySnaps = await Promise.all(
    days.map((k) => db.collection(PLATFORM_SECURITY_DAILY_COLLECTION).doc(k).get())
  );
  const series = dailySnaps.map((s, i) => {
    const data = s.data() ?? {};
    return {
      date: days[i],
      events: typeof data.events === "number" ? data.events : 0,
      blocked: typeof data.blocked === "number" ? data.blocked : 0,
      failedLogin: typeof data.failedLogin === "number" ? data.failedLogin : 0,
      rateLimits: typeof data.rateLimits === "number" ? data.rateLimits : 0,
    };
  });

  const openHigh = items.filter(
    (x) =>
      !(x as { resolvedAt?: unknown }).resolvedAt &&
      ((x as { severity?: string }).severity === "HIGH" ||
        (x as { severity?: string }).severity === "CRITICAL")
  ).length;

  const status =
    openHigh > 0 ? "critical" : items.some((x) => !(x as { resolvedAt?: unknown }).resolvedAt && (x as { severity?: string }).severity === "MEDIUM") ? "elevated" : "ok";

  return NextResponse.json({
    ok: true,
    status,
    kpi: {
      suspiciousToday: typeof daily.events === "number" ? daily.events : 0,
      blockedToday: typeof daily.blocked === "number" ? daily.blocked : 0,
      failedLoginToday: typeof daily.failedLogin === "number" ? daily.failedLogin : 0,
      rateLimitsToday: typeof daily.rateLimits === "number" ? daily.rateLimits : 0,
      highToday: typeof daily.high === "number" ? daily.high : 0,
      criticalToday: typeof daily.critical === "number" ? daily.critical : 0,
      openHighCritical: openHigh,
    },
    series,
    incidents: items,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const body = (await request.json()) as { incidentId?: string };
  const incidentId = String(body.incidentId ?? "").trim();
  if (!incidentId) {
    return NextResponse.json({ error: "Chybí incidentId." }, { status: 400 });
  }

  await db.collection(PLATFORM_SECURITY_INCIDENTS_COLLECTION).doc(incidentId).update({
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: auth.session.username,
  });

  await writeSecurityAudit(db, {
    action: "security_incident_resolved",
    actor: auth.session.username,
    metadata: { incidentId },
  });

  return NextResponse.json({ ok: true });
}
