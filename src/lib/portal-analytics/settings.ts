import type { Firestore } from "firebase-admin/firestore";
import { PLATFORM_PORTAL_ANALYTICS_SETTINGS_COLLECTION } from "@/lib/firestore-collections";

export type PortalAnalyticsActivityLabel =
  | "active"
  | "medium"
  | "low"
  | "inactive";

export type PortalAnalyticsSettings = {
  retentionDays: number;
  activityScore: {
    activeMin: number;
    mediumMin: number;
    lowMin: number;
  };
  alerts: {
    inactiveLoginDays: number;
    newOrgNoJobDays: number;
    activityDropPct: number;
    aiSpikeMultiplier: number;
    workflowAbandonMinCount: number;
  };
};

export const DEFAULT_PORTAL_ANALYTICS_SETTINGS: PortalAnalyticsSettings = {
  retentionDays: 90,
  activityScore: {
    activeMin: 70,
    mediumMin: 40,
    lowMin: 15,
  },
  alerts: {
    inactiveLoginDays: 14,
    newOrgNoJobDays: 14,
    activityDropPct: 50,
    aiSpikeMultiplier: 3,
    workflowAbandonMinCount: 25,
  },
};

export function activityLabelFromScore(
  score: number,
  settings: PortalAnalyticsSettings
): PortalAnalyticsActivityLabel {
  if (score >= settings.activityScore.activeMin) return "active";
  if (score >= settings.activityScore.mediumMin) return "medium";
  if (score >= settings.activityScore.lowMin) return "low";
  return "inactive";
}

export function activityLabelCs(label: PortalAnalyticsActivityLabel): string {
  switch (label) {
    case "active":
      return "Aktivní";
    case "medium":
      return "Středně aktivní";
    case "low":
      return "Málo aktivní";
    default:
      return "Neaktivní";
  }
}

export async function loadPortalAnalyticsSettings(
  db: Firestore
): Promise<PortalAnalyticsSettings> {
  const snap = await db
    .collection(PLATFORM_PORTAL_ANALYTICS_SETTINGS_COLLECTION)
    .doc("default")
    .get();
  if (!snap.exists) return DEFAULT_PORTAL_ANALYTICS_SETTINGS;
  const d = snap.data() as Record<string, unknown>;
  const score = (d.activityScore as Record<string, unknown>) ?? {};
  const alerts = (d.alerts as Record<string, unknown>) ?? {};
  return {
    retentionDays:
      typeof d.retentionDays === "number" && d.retentionDays > 0
        ? d.retentionDays
        : DEFAULT_PORTAL_ANALYTICS_SETTINGS.retentionDays,
    activityScore: {
      activeMin: numOr(score.activeMin, DEFAULT_PORTAL_ANALYTICS_SETTINGS.activityScore.activeMin),
      mediumMin: numOr(score.mediumMin, DEFAULT_PORTAL_ANALYTICS_SETTINGS.activityScore.mediumMin),
      lowMin: numOr(score.lowMin, DEFAULT_PORTAL_ANALYTICS_SETTINGS.activityScore.lowMin),
    },
    alerts: {
      inactiveLoginDays: numOr(
        alerts.inactiveLoginDays,
        DEFAULT_PORTAL_ANALYTICS_SETTINGS.alerts.inactiveLoginDays
      ),
      newOrgNoJobDays: numOr(
        alerts.newOrgNoJobDays,
        DEFAULT_PORTAL_ANALYTICS_SETTINGS.alerts.newOrgNoJobDays
      ),
      activityDropPct: numOr(
        alerts.activityDropPct,
        DEFAULT_PORTAL_ANALYTICS_SETTINGS.alerts.activityDropPct
      ),
      aiSpikeMultiplier: numOr(
        alerts.aiSpikeMultiplier,
        DEFAULT_PORTAL_ANALYTICS_SETTINGS.alerts.aiSpikeMultiplier
      ),
      workflowAbandonMinCount: numOr(
        alerts.workflowAbandonMinCount,
        DEFAULT_PORTAL_ANALYTICS_SETTINGS.alerts.workflowAbandonMinCount
      ),
    },
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
