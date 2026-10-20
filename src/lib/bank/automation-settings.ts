import type { BankAutomationSettings, BankConnectionDoc } from "@/lib/bank/types";

export const BANK_SYNC_INTERVAL_MS = 5 * 60 * 60 * 1000;

export function defaultBankAutomationSettings(): BankAutomationSettings {
  return {
    autoSyncEnabled: true,
    autoMatchEnabled: true,
    autoPaymentConfirmationEnabled: false,
    paymentConfirmationEmailAccountId: null,
    autoPartialPaymentConfirmation: false,
  };
}

export function parseBankAutomationSettings(
  raw: BankAutomationSettings | null | undefined
): BankAutomationSettings {
  const d = defaultBankAutomationSettings();
  if (!raw) return d;
  return {
    autoSyncEnabled: raw.autoSyncEnabled !== false,
    autoMatchEnabled: raw.autoMatchEnabled !== false,
    autoPaymentConfirmationEnabled: raw.autoPaymentConfirmationEnabled === true,
    paymentConfirmationEmailAccountId:
      raw.paymentConfirmationEmailAccountId != null
        ? String(raw.paymentConfirmationEmailAccountId).trim() || null
        : null,
    autoPartialPaymentConfirmation: raw.autoPartialPaymentConfirmation === true,
    monthlyMarketingReportEnabled: raw.monthlyMarketingReportEnabled === true,
    monthlyMarketingReportEmails:
      raw.monthlyMarketingReportEmails != null
        ? String(raw.monthlyMarketingReportEmails).trim() || null
        : null,
  };
}

export function automationSettingsFromConnection(
  conn: BankConnectionDoc | null
): BankAutomationSettings {
  return parseBankAutomationSettings(conn?.automation ?? null);
}

export function computeNextScheduledSyncAt(fromMs: number = Date.now()): string {
  const next = Math.ceil(fromMs / BANK_SYNC_INTERVAL_MS) * BANK_SYNC_INTERVAL_MS;
  return new Date(next).toISOString();
}

export function bankAutomationPublicView(conn: BankConnectionDoc | null) {
  const settings = automationSettingsFromConnection(conn);
  const stats = conn?.automationStats ?? null;
  return {
    settings: {
      autoSyncEnabled: settings.autoSyncEnabled,
      autoMatchEnabled: settings.autoMatchEnabled,
      autoPaymentConfirmationEnabled: settings.autoPaymentConfirmationEnabled,
      paymentConfirmationEmailAccountId: settings.paymentConfirmationEmailAccountId,
      autoPartialPaymentConfirmation: settings.autoPartialPaymentConfirmation,
      monthlyMarketingReportEnabled: settings.monthlyMarketingReportEnabled === true,
      monthlyMarketingReportEmails: settings.monthlyMarketingReportEmails ?? null,
    },
    stats: {
      lastAutoSyncAt: stats?.lastAutoSyncAt ?? conn?.lastSyncAt ?? null,
      nextScheduledSyncAt: stats?.nextScheduledSyncAt ?? computeNextScheduledSyncAt(),
      lastAutoMatchAt: stats?.lastAutoMatchAt ?? null,
      lastRunImported: stats?.lastRunImported ?? conn?.lastSyncStats?.imported ?? 0,
      lastRunAutoMatched: stats?.lastRunAutoMatched ?? 0,
      pendingReviewCount: stats?.pendingReviewCount ?? 0,
      confirmationsSentTotal: stats?.confirmationsSentTotal ?? 0,
      lastConfirmationSentAt: stats?.lastConfirmationSentAt ?? null,
      lastAutoSyncError: stats?.lastAutoSyncError ?? conn?.lastSyncError ?? null,
    },
  };
}
