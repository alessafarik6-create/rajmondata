import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { OrganizationAiAuditActionType } from "@/lib/ai/organization-ai-audit-server";

const AI_ACTIONS = new Set<string>([
  "ORG_AI_BRIEFING",
  "ORG_AI_ASK",
  "ORG_AI_HOT_TODAY",
]);

export type OrganizationAiUsageStats = {
  queriesToday: number;
  queriesThisMonth: number;
  activeUsersThisMonth: number;
  byEmployee: { userId: string; employeeName: string | null; count: number }[];
  byActionType: Record<OrganizationAiAuditActionType, number>;
  seriesLast30Days: { date: string; count: number }[];
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function logCreatedAt(log: QueryDocumentSnapshot): Date | null {
  const raw = log.data().createdAt;
  if (raw && typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return null;
}

export async function loadOrganizationAiUsageStats(
  db: Firestore,
  organizationId: string,
  opts?: { maxLogs?: number }
): Promise<OrganizationAiUsageStats> {
  const orgId = String(organizationId ?? "").trim();
  const maxLogs = opts?.maxLogs ?? 2500;
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(orgId)
    .collection("activityLogs")
    .orderBy("createdAt", "desc")
    .limit(maxLogs)
    .get();

  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const seriesStart = new Date(todayStart);
  seriesStart.setDate(seriesStart.getDate() - 29);

  const byActionType: OrganizationAiUsageStats["byActionType"] = {
    ORG_AI_ASK: 0,
    ORG_AI_BRIEFING: 0,
    ORG_AI_HOT_TODAY: 0,
  };
  const byUser = new Map<string, { name: string | null; count: number }>();
  const seriesMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(seriesStart);
    d.setDate(seriesStart.getDate() + i);
    seriesMap.set(dayKey(d), 0);
  }

  let queriesToday = 0;
  let queriesThisMonth = 0;
  const activeUsersMonth = new Set<string>();

  for (const doc of snap.docs) {
    const data = doc.data();
    const actionType = String(data.actionType ?? "");
    if (!AI_ACTIONS.has(actionType)) continue;
    const at = logCreatedAt(doc);
    if (!at) continue;

    if (at >= todayStart) queriesToday += 1;
    if (at >= monthStart) {
      queriesThisMonth += 1;
      const uid = String(data.userId ?? "").trim();
      if (uid) activeUsersMonth.add(uid);
    }

    if (at >= seriesStart) {
      const key = dayKey(at);
      if (seriesMap.has(key)) {
        seriesMap.set(key, (seriesMap.get(key) ?? 0) + 1);
      }
    }

    if (actionType in byActionType) {
      byActionType[actionType as OrganizationAiAuditActionType] += 1;
    }

    const uid = String(data.userId ?? "").trim();
    if (uid) {
      const prev = byUser.get(uid) ?? {
        name: typeof data.employeeName === "string" ? data.employeeName : null,
        count: 0,
      };
      prev.count += 1;
      if (!prev.name && typeof data.employeeName === "string") {
        prev.name = data.employeeName;
      }
      byUser.set(uid, prev);
    }
  }

  const byEmployee = [...byUser.entries()]
    .map(([userId, v]) => ({
      userId,
      employeeName: v.name,
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const seriesLast30Days = [...seriesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  return {
    queriesToday,
    queriesThisMonth,
    activeUsersThisMonth: activeUsersMonth.size,
    byEmployee,
    byActionType,
    seriesLast30Days,
  };
}
