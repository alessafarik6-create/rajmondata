import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  ORGANIZATIONS_COLLECTION,
  PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION,
} from "@/lib/firestore-collections";
import { loadOrganizationEntityCounts } from "@/lib/portal-analytics/org-stats-server";
import {
  loadOrgPortalAnalyticsRange,
  parseDateRangeQuery,
  sumEvent,
} from "@/lib/portal-analytics/summary-load";
import {
  computeOrganizationActivityScore,
  metricsFromOrgDailyRows,
} from "@/lib/portal-analytics/activity-score";
import { loadPortalAnalyticsSettings } from "@/lib/portal-analytics/settings";

export type PortalAnalyticsAlertDoc = {
  id: string;
  type: string;
  organizationId: string;
  organizationName: string;
  message: string;
  severity: "info" | "warning" | "critical";
  createdAt: unknown;
  dedupeKey: string;
};

export async function generatePortalAnalyticsAlerts(db: Firestore): Promise<number> {
  const settings = await loadPortalAnalyticsSettings(db);
  const { dayKeys } = parseDateRangeQuery({ days: 30 });
  const prevKeys = parseDateRangeQuery({ days: 60 }).dayKeys.slice(0, 30);

  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).limit(300).get();
  let created = 0;

  for (const doc of orgSnap.docs) {
    const orgId = doc.id;
    const name = String(doc.data().name ?? doc.data().companyName ?? orgId);
    const createdAt = doc.data().createdAt as { toDate?: () => Date } | undefined;
    const regMs = createdAt?.toDate?.()?.getTime() ?? 0;

    const [rows30, rowsPrev, counts] = await Promise.all([
      loadOrgPortalAnalyticsRange(db, orgId, dayKeys),
      loadOrgPortalAnalyticsRange(db, orgId, prevKeys),
      loadOrganizationEntityCounts(db, orgId),
    ]);

    const metrics = metricsFromOrgDailyRows(rows30, dayKeys.length);
    const score = computeOrganizationActivityScore(
      { userAccounts: Math.max(1, counts.userAccounts), ...metrics },
      settings
    );

    const logins30 = metrics.logins30;
    const loginsPrev = sumEvent(rowsPrev, "login");
    const lastLoginDaysAgo =
      logins30 === 0
        ? settings.alerts.inactiveLoginDays + 1
        : 0;

    const alerts: Omit<PortalAnalyticsAlertDoc, "id" | "createdAt">[] = [];

    if (logins30 === 0 && Date.now() - regMs > 86400000 * 3) {
      alerts.push({
        type: "org_no_login_30d",
        organizationId: orgId,
        organizationName: name,
        message: `Organizace „${name}“ nemá přihlášení za posledních 30 dní.`,
        severity: "warning",
        dedupeKey: `${orgId}:org_no_login_30d:${dayKeys[dayKeys.length - 1]}`,
      });
    }

    if (
      regMs > 0 &&
      Date.now() - regMs > settings.alerts.newOrgNoJobDays * 86400000 &&
      counts.jobs === 0
    ) {
      alerts.push({
        type: "new_org_no_job",
        organizationId: orgId,
        organizationName: name,
        message: `Nová organizace „${name}“ zatím nezaložila první zakázku.`,
        severity: "info",
        dedupeKey: `${orgId}:new_org_no_job`,
      });
    }

    if (loginsPrev > 5 && logins30 < loginsPrev * (1 - settings.alerts.activityDropPct / 100)) {
      alerts.push({
        type: "activity_drop",
        organizationId: orgId,
        organizationName: name,
        message: `Aktivita organizace „${name}“ výrazně poklesla (${logins30} vs ${loginsPrev} přihlášení).`,
        severity: "warning",
        dedupeKey: `${orgId}:activity_drop:${dayKeys[dayKeys.length - 1]}`,
      });
    }

    const ai30 = sumEvent(rows30, "ai_feature_used");
    const aiPrev = sumEvent(rowsPrev, "ai_feature_used");
    if (aiPrev > 0 && ai30 >= aiPrev * settings.alerts.aiSpikeMultiplier) {
      alerts.push({
        type: "ai_spike",
        organizationId: orgId,
        organizationName: name,
        message: `Organizace „${name}“ intenzivně využívá AI (${ai30} událostí / 30 dní).`,
        severity: "info",
        dedupeKey: `${orgId}:ai_spike:${dayKeys[dayKeys.length - 1]}`,
      });
    }

    const abandoned = sumEvent(rows30, "form_abandoned");
    const completed = sumEvent(rows30, "form_completed");
    if (
      abandoned >= settings.alerts.workflowAbandonMinCount &&
      abandoned > completed * 2
    ) {
      alerts.push({
        type: "workflow_abandon",
        organizationId: orgId,
        organizationName: name,
        message: `U organizace „${name}“ uživatelé často nedokončují formuláře (${abandoned} opuštění).`,
        severity: "warning",
        dedupeKey: `${orgId}:workflow_abandon:${dayKeys[dayKeys.length - 1]}`,
      });
    }

    await db.collection(ORGANIZATIONS_COLLECTION).doc(orgId).set(
      {
        portalAnalyticsCache: {
          updatedAt: FieldValue.serverTimestamp(),
          score: score.score,
          scorePerUser: score.scorePerUser,
          label: score.label,
          logins30d: logins30,
          activeDays30d: metrics.activeDays30,
          activeUsers30d: metrics.activeUsers30,
          lastLoginEstimateDaysAgo: lastLoginDaysAgo,
        },
      },
      { merge: true }
    );

    for (const a of alerts) {
      const ref = db.collection(PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION).doc(a.dedupeKey);
      const existing = await ref.get();
      if (existing.exists) continue;
      await ref.set({
        ...a,
        createdAt: FieldValue.serverTimestamp(),
      });
      created += 1;
    }
  }

  return created;
}
