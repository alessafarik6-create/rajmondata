import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import {
  loadGlobalPortalAnalyticsRange,
  mergeDailyMaps,
  parseDateRangeQuery,
  sumEvent,
} from "@/lib/portal-analytics/summary-load";
import { countOrganizationsRegisteredSince } from "@/lib/analytics/registration-stats";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const sp = request.nextUrl.searchParams;
  const { dayKeys, from, to } = parseDateRangeQuery({
    from: sp.get("from"),
    to: sp.get("to"),
    days: Number(sp.get("days") || 30),
  });

  const rows = await loadGlobalPortalAnalyticsRange(db, dayKeys);
  const modules = mergeDailyMaps(rows, "modules");
  const workflows = mergeDailyMaps(rows, "workflows");
  const devices = mergeDailyMaps(rows, "devices");
  const events = mergeDailyMaps(rows, "events");

  const dailyActiveOrgs: { date: string; count: number }[] = [];
  for (const date of dayKeys) {
    const snap = await db
      .collection("platform_portal_analytics_org_daily")
      .where("date", "==", date)
      .limit(2000)
      .get()
      .catch(() => null);
    dailyActiveOrgs.push({ date, count: snap?.size ?? 0 });
  }

  const now = Date.now();
  const dayMs = 86400000;
  const newOrgsMonth = await countOrganizationsRegisteredSince(db, now - 30 * dayMs);

  const growthSeries = dayKeys.map((date) => ({
    date,
    visits: rows.find((r) => r.date === date)?.events?.module_opened ?? 0,
    logins: rows.find((r) => r.date === date)?.events?.login ?? 0,
  }));

  const workflowSuccess = {
    jobStarted: events.form_started ? pickWorkflow(workflows, "new_job", "form_started") : 0,
    jobCompleted: pickWorkflow(workflows, "new_job", "form_completed"),
    jobAbandoned: pickWorkflow(workflows, "new_job", "form_abandoned"),
    offerStarted: pickWorkflow(workflows, "new_offer", "form_started"),
    offerCompleted: pickWorkflow(workflows, "new_offer", "form_completed"),
    offerAbandoned: pickWorkflow(workflows, "new_offer", "form_abandoned"),
    aiUsed: events.ai_feature_used ?? 0,
    aiFollowUp: events.invoice_issued ?? 0,
  };

  return NextResponse.json({
    ok: true,
    period: { from: from.toISOString(), to: to.toISOString(), days: dayKeys.length },
    modules,
    devices,
    events,
    workflows,
    dailyActiveOrganizations: dailyActiveOrgs,
    growth: {
      newOrganizations30d: newOrgsMonth,
      logins30d: sumEvent(rows, "login"),
      moduleOpens30d: sumEvent(rows, "module_opened"),
      series: growthSeries,
    },
    workflowSuccess,
  });
}

function pickWorkflow(
  map: Record<string, number>,
  formKey: string,
  suffix: string
): number {
  return map[`${formKey}:${suffix}`] ?? map[`${formKey}_${suffix}`] ?? 0;
}
