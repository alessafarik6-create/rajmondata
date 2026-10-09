import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { getCompany } from "@/lib/superadmin-companies";
import {
  loadLastStaffSessionActivity,
  loadOrganizationEntityCounts,
  loadOrganizationRegistrationDate,
} from "@/lib/portal-analytics/org-stats-server";
import {
  loadGlobalPortalAnalyticsRange,
  loadOrgPortalAnalyticsRange,
  mergeDailyMaps,
  parseDateRangeQuery,
  sumEvent,
} from "@/lib/portal-analytics/summary-load";
import {
  computeOrganizationActivityScore,
  metricsFromOrgDailyRows,
} from "@/lib/portal-analytics/activity-score";
import {
  activityLabelCs,
  loadPortalAnalyticsSettings,
} from "@/lib/portal-analytics/settings";
import { PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id: organizationId } = await context.params;
  const company = await getCompany(db, organizationId);
  if (!company) {
    return NextResponse.json({ error: "Organizace nenalezena." }, { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const { dayKeys, from, to } = parseDateRangeQuery({
    from: sp.get("from"),
    to: sp.get("to"),
    days: Number(sp.get("days") || 30),
  });

  const settings = await loadPortalAnalyticsSettings(db);

  const [counts, registeredAt, lastActivity, orgDaily, globalDaily] = await Promise.all([
    loadOrganizationEntityCounts(db, organizationId),
    loadOrganizationRegistrationDate(db, organizationId),
    loadLastStaffSessionActivity(db, organizationId),
    loadOrgPortalAnalyticsRange(db, organizationId, dayKeys),
    loadGlobalPortalAnalyticsRange(db, dayKeys),
  ]);

  const metrics = metricsFromOrgDailyRows(orgDaily, dayKeys.length);
  const score = computeOrganizationActivityScore(
    { userAccounts: Math.max(1, counts.userAccounts), ...metrics },
    settings
  );

  try {
    await db.collection(PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION).add({
      action: "VIEW_ORG_ANALYTICS_DETAIL",
      organizationId,
      superadmin: auth.session.username,
      at: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit volitelný */
  }

  const moduleUsage = mergeDailyMaps(orgDaily, "modules");
  const workflows = mergeDailyMaps(orgDaily, "workflows");
  const devices = mergeDailyMaps(orgDaily, "devices");

  const series = dayKeys.map((date) => {
    const row = orgDaily.find((r) => r.date === date);
    const ev = row?.events ?? {};
    const total = Object.values(ev).reduce((a, b) => a + b, 0);
    return {
      date,
      events: total,
      logins: ev.login ?? 0,
      moduleOpens: ev.module_opened ?? 0,
    };
  });

  return NextResponse.json({
    ok: true,
    organization: {
      id: organizationId,
      name: company.name,
      registeredAt: registeredAt ?? company.createdAt,
    },
    period: { from: from.toISOString(), to: to.toISOString(), days: dayKeys.length },
    counts,
    activity: {
      lastActivityAt: lastActivity,
      logins: metrics.logins30,
      activeUsers: metrics.activeUsers30,
      activeDays: metrics.activeDays30,
      score: score.score,
      scorePerUser: score.scorePerUser,
      label: score.label,
      labelCs: activityLabelCs(score.label),
      breakdown: score.breakdown,
    },
    periodMetrics: {
      jobsCreated: sumEvent(orgDaily, "job_created"),
      offersCreated: sumEvent(orgDaily, "offer_created"),
      leadsCreated: sumEvent(orgDaily, "lead_created"),
      invoicesIssued: sumEvent(orgDaily, "invoice_issued"),
      documentsUploaded: sumEvent(orgDaily, "document_uploaded"),
      aiUsed: sumEvent(orgDaily, "ai_feature_used"),
      attendanceTerminal: sumEvent(orgDaily, "attendance_terminal_used"),
      reportsOpened: sumEvent(orgDaily, "reports_opened"),
    },
    moduleUsage,
    workflows,
    devices,
    series,
    globalContext: {
      moduleUsage: mergeDailyMaps(globalDaily, "modules"),
    },
  });
}
