import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { getCompanies } from "@/lib/superadmin-companies";
import {
  aggregateUsersByPresence,
  loadActiveStaffSessionsForOrg,
  loadGlobalLastLogin,
  loadOrgLastLogin,
  loadTodayActionCount,
} from "@/lib/analytics-realtime/presence-server";
import { loadOrgPortalAnalyticsRange, parseDateRangeQuery } from "@/lib/portal-analytics/summary-load";
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
    return NextResponse.json({ ok: false, error: "Firebase Admin není k dispozici." }, { status: 503 });
  }

  const nowMs = Date.now();
  const companies = await getCompanies(db, { light: true });
  const orgIds = companies.map((c) => c.id);

  const [orgPresence, actionsToday, lastLoginGlobal] = await Promise.all([
    mapPool(companies, 8, async (c) => {
      const sessions = await loadActiveStaffSessionsForOrg(db, c.id, nowMs);
      const users = aggregateUsersByPresence(sessions);
      const onlineUsers = users.filter((u) => u.presence === "online").length;
      const loggedInUsers = users.filter((u) => u.presence !== "offline").length;
      const [lastActivityAt, lastLoginAt] = await Promise.all([
        loadLastStaffSessionActivity(db, c.id),
        loadOrgLastLogin(db, c.id),
      ]);
      return {
        organizationId: c.id,
        name: c.name,
        onlineUsers,
        loggedInUsers,
        lastActivityAt,
        lastLoginAt,
        users,
        sessions,
      };
    }),
    loadTodayActionCount(db),
    loadGlobalLastLogin(db, orgIds),
  ]);

  let onlineTotal = 0;
  let loggedInTotal = 0;
  const onlineUserIds = new Set<string>();
  for (const o of orgPresence) {
    onlineTotal += o.onlineUsers;
    loggedInTotal += o.loggedInUsers;
    for (const u of o.users) {
      if (u.presence === "online") onlineUserIds.add(u.userId);
    }
  }

  const activeOrganizations = orgPresence.filter((o) => o.onlineUsers > 0).length;

  const { dayKeys } = parseDateRangeQuery({ days: 1 });
  let activity24h = 0;
  for (const orgId of orgIds.slice(0, 30)) {
    const daily = await loadOrgPortalAnalyticsRange(db, orgId, dayKeys);
    for (const row of daily) {
      const ev = row.events ?? {};
      activity24h += Object.values(ev).reduce((a, b) => a + (Number(b) || 0), 0);
    }
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      onlineUsers: onlineUserIds.size,
      loggedInUsers: loggedInTotal,
      activeOrganizations,
      activity24h,
      lastLoginAt: lastLoginGlobal,
      actionsToday,
    },
    organizations: orgPresence.map((o) => ({
      organizationId: o.organizationId,
      name: o.name,
      onlineUsers: o.onlineUsers,
      loggedInUsers: o.loggedInUsers,
      lastActivityAt: o.lastActivityAt,
      lastLoginAt: o.lastLoginAt,
    })),
  });
}
