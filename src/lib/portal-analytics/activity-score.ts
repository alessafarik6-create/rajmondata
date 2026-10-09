import type { PortalAnalyticsDailyRow } from "@/lib/portal-analytics/summary-load";
import { sumEvent } from "@/lib/portal-analytics/summary-load";
import {
  activityLabelFromScore,
  type PortalAnalyticsActivityLabel,
  type PortalAnalyticsSettings,
} from "@/lib/portal-analytics/settings";

export type OrganizationActivityScoreInput = {
  userAccounts: number;
  activeDays30: number;
  activeUsers30: number;
  logins30: number;
  moduleOpens30: number;
  businessOps30: number;
  periodDays: number;
};

export type OrganizationActivityScoreResult = {
  score: number;
  scorePerUser: number;
  label: PortalAnalyticsActivityLabel;
  breakdown: {
    loginRate: number;
    activeUserRate: number;
    activeDayRate: number;
    moduleRate: number;
    opsRate: number;
  };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}

/** Skóre 0–100 — váhy s normalizací na počet uživatelů (malé firmy nejsou penalizované). */
export function computeOrganizationActivityScore(
  input: OrganizationActivityScoreInput,
  settings: PortalAnalyticsSettings
): OrganizationActivityScoreResult {
  const users = Math.max(1, input.userAccounts);
  const period = Math.max(1, Math.min(90, input.periodDays));

  const loginRate = clamp01(input.logins30 / (users * period));
  const activeUserRate = clamp01(input.activeUsers30 / users);
  const activeDayRate = clamp01(input.activeDays30 / period);
  const moduleRate = clamp01(input.moduleOpens30 / (users * period * 4));
  const opsRate = clamp01(input.businessOps30 / (users * period * 2));

  const scoreRaw =
    100 *
    (0.22 * loginRate +
      0.22 * activeUserRate +
      0.2 * activeDayRate +
      0.18 * moduleRate +
      0.18 * opsRate);

  const score = Math.round(Math.min(100, Math.max(0, scoreRaw)));
  const scorePerUser = Math.round((score / Math.sqrt(users)) * 10) / 10;

  return {
    score,
    scorePerUser,
    label: activityLabelFromScore(score, settings),
    breakdown: {
      loginRate: Math.round(loginRate * 1000) / 10,
      activeUserRate: Math.round(activeUserRate * 1000) / 10,
      activeDayRate: Math.round(activeDayRate * 1000) / 10,
      moduleRate: Math.round(moduleRate * 1000) / 10,
      opsRate: Math.round(opsRate * 1000) / 10,
    },
  };
}

export function metricsFromOrgDailyRows(
  rows: PortalAnalyticsDailyRow[],
  periodDays: number
): Omit<OrganizationActivityScoreInput, "userAccounts"> {
  const moduleOpens = rows.reduce(
    (acc, r) => acc + (r.events.module_opened ?? 0),
    0
  );
  const businessOps =
    sumEvent(rows, "job_created") +
    sumEvent(rows, "lead_created") +
    sumEvent(rows, "offer_created") +
    sumEvent(rows, "invoice_issued") +
    sumEvent(rows, "document_uploaded") +
    sumEvent(rows, "ai_feature_used");

  const activeDays = rows.filter((r) =>
    Object.values(r.events).some((v) => v > 0)
  ).length;

  const activeUsers = Math.max(
    0,
    ...rows.map((r) => r.uniqueUsersEstimate ?? 0)
  );

  return {
    activeDays30: activeDays,
    activeUsers30: activeUsers,
    logins30: sumEvent(rows, "login"),
    moduleOpens30: moduleOpens,
    businessOps30: businessOps,
    periodDays,
  };
}
