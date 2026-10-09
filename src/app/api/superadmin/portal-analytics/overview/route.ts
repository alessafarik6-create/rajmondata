import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { getCompanies } from "@/lib/superadmin-companies";
import { loadOrganizationEntityCounts } from "@/lib/portal-analytics/org-stats-server";
import {
  loadOrgPortalAnalyticsRange,
  parseDateRangeQuery,
  metricsFromOrgDailyRows,
} from "@/lib/portal-analytics/summary-load";
import {
  computeOrganizationActivityScore,
} from "@/lib/portal-analytics/activity-score";
import {
  activityLabelCs,
  loadPortalAnalyticsSettings,
} from "@/lib/portal-analytics/settings";
import { loadLastStaffSessionActivity } from "@/lib/portal-analytics/org-stats-server";

export const dynamic = "force-dynamic";

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

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

  const settings = await loadPortalAnalyticsSettings(db);
  const companies = await getCompanies(db, { light: true });

  const rows = await mapPool(companies, 6, async (c) => {
    const orgId = c.id;
    const cache = (c as Record<string, unknown>).portalAnalyticsCache as
      | Record<string, unknown>
      | undefined;
    const [counts, daily, lastActivity] = await Promise.all([
      loadOrganizationEntityCounts(db, orgId),
      loadOrgPortalAnalyticsRange(db, orgId, dayKeys),
      loadLastStaffSessionActivity(db, orgId),
    ]);
    const metrics = metricsFromOrgDailyRows(daily, dayKeys.length);
    const score = computeOrganizationActivityScore(
      { userAccounts: Math.max(1, counts.userAccounts), ...metrics },
      settings
    );

    return {
      organizationId: orgId,
      name: c.name,
      registeredAt: c.createdAt,
      userAccounts: counts.userAccounts,
      employees: counts.employees,
      jobs: counts.jobs,
      leads: counts.leads,
      offers: counts.offers,
      invoices: counts.invoices,
      lastActivityAt: lastActivity,
      logins30d: metrics.logins30,
      activeDays30d: metrics.activeDays30,
      activeUsers30d: metrics.activeUsers30,
      activityScore: score.score,
      activityScorePerUser: score.scorePerUser,
      activityLabel: score.label,
      activityLabelCs: activityLabelCs(score.label),
      cacheUpdatedAt: cache?.updatedAt ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    period: { from: from.toISOString(), to: to.toISOString(), days: dayKeys.length },
    settings,
    organizations: rows,
  });
}
