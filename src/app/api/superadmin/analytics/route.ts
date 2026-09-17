import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import {
  aggregateTopPages,
  loadAnalyticsDailyRange,
  mergeMaps,
  sumRows,
} from "@/lib/analytics/analytics-summary";
import {
  countOrganizationsRegisteredSince,
  registrationSeries,
} from "@/lib/analytics/registration-stats";

export const dynamic = "force-dynamic";

function daysFromRange(range: string): number {
  if (range === "24h") return 1;
  if (range === "90d") return 90;
  if (range === "30d") return 30;
  return 7;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const days = daysFromRange(range);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const rows = await loadAnalyticsDailyRange(db, days);
  const today = rows[rows.length - 1];
  const last7 = rows.slice(-7);
  const last30 = rows.slice(-30);

  const sumToday = today ? { pageviews: today.pageviews, visits: today.visits, uniqueVisitors: today.uniqueVisitors } : { pageviews: 0, visits: 0, uniqueVisitors: 0 };
  const sum7 = sumRows(last7);
  const sum30 = sumRows(last30);

  const regToday = await countOrganizationsRegisteredSince(db, now - dayMs);
  const reg7 = await countOrganizationsRegisteredSince(db, now - 7 * dayMs);
  const reg30 = await countOrganizationsRegisteredSince(db, now - 30 * dayMs);
  const reg90 = await countOrganizationsRegisteredSince(db, now - 90 * dayMs);

  const unique30 = sum30.uniqueVisitors || 1;
  const conversionPct =
    reg30 > 0 && unique30 > 0 ? Math.round((reg30 / unique30) * 10000) / 100 : 0;

  const regSeries = await registrationSeries(db, Math.min(days, 90));
  const funnel = mergeMaps(rows, "funnel");

  return NextResponse.json({
    ok: true,
    provider: "first_party_aggregated",
    realtimeSupported: false,
    kpi: {
      visitsToday: sumToday.visits,
      visits7d: sum7.visits,
      visits30d: sum30.visits,
      uniqueVisitors30d: sum30.uniqueVisitors,
      pageviews30d: sum30.pageviews,
      registrationsToday: regToday,
      registrations7d: reg7,
      registrations30d: reg30,
      conversionPct30d: conversionPct,
    },
    series: rows.map((r) => ({
      date: r.date,
      visits: r.visits,
      pageviews: r.pageviews,
      uniqueVisitors: r.uniqueVisitors,
    })),
    topPages: aggregateTopPages(rows),
    referrers: mergeMaps(rows, "referrers"),
    devices: mergeMaps(rows, "devices"),
    countries: mergeMaps(rows, "countries"),
    funnel,
    registrations: {
      today: regToday,
      d7: reg7,
      d30: reg30,
      d90: reg90,
      series: regSeries,
    },
  });
}
