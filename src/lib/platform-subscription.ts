import type { CompanyLicenseDoc } from "@/lib/platform-config";
import { addDaysIso } from "@/lib/company-license-record";

export type PlatformSubscriptionStatus =
  | "TRIAL"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "CANCELLED";

export type PlatformTrialSettings = {
  trialEnabled: boolean;
  trialDays: number;
  trialPriceCzk: number;
};

export const DEFAULT_PLATFORM_TRIAL_SETTINGS: PlatformTrialSettings = {
  trialEnabled: true,
  trialDays: 30,
  trialPriceCzk: 0,
};

export function parseTrialSettingsFromRecord(
  raw: Record<string, unknown> | null | undefined
): PlatformTrialSettings {
  const d = raw ?? {};
  const num = (v: unknown, fb: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    trialEnabled: d.trialEnabled !== false,
    trialDays: Math.max(1, Math.min(365, Math.round(num(d.trialDays, DEFAULT_PLATFORM_TRIAL_SETTINGS.trialDays)))),
    trialPriceCzk: Math.max(0, num(d.trialPriceCzk, DEFAULT_PLATFORM_TRIAL_SETTINGS.trialPriceCzk)),
  };
}

export function trialEndsAtFromStart(startIso: string, trialDays: number): string {
  const start = Date.parse(startIso);
  const base = Number.isFinite(start) ? new Date(start) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + trialDays);
  return d.toISOString();
}

export function remainingTrialDays(trialEndsAt: string | null | undefined, now = Date.now()): number {
  if (!trialEndsAt) return 0;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return 0;
  const diff = end - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function formatTrialEndDateCs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export type TrialLicensePatch = {
  subscriptionStatus: PlatformSubscriptionStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  trialConsumed: true;
  active: boolean;
  status: "trial" | "active" | "expired";
  expiresAt: string;
  activatedAt: string;
};

/** Aplikuje zkušební licenci na existující záznam (např. po registraci). */
export function buildTrialCompanyLicense(
  license: CompanyLicenseDoc,
  trialDays: number,
  startedAtIso?: string
): CompanyLicenseDoc {
  const started = startedAtIso ?? new Date().toISOString();
  const ends = trialEndsAtFromStart(started, trialDays);
  return {
    ...license,
    active: true,
    status: "trial",
    subscriptionStatus: "TRIAL",
    trialStartedAt: started,
    trialEndsAt: ends,
    trialConsumed: true,
    activatedAt: license.activatedAt ?? started,
    expiresAt: ends,
    notes: license.notes?.trim()
      ? `${license.notes.trim()}\n[auto] Zkušební období ${trialDays} dní.`
      : `[auto] Zkušební období ${trialDays} dní.`,
    pricingSnapshot: {
      ...license.pricingSnapshot,
      trialDays,
      trialPriceCzk: 0,
    },
  };
}

export function isTrialSubscription(
  license: Pick<CompanyLicenseDoc, "subscriptionStatus" | "status"> | null | undefined
): boolean {
  if (!license) return false;
  if (license.subscriptionStatus === "TRIAL") return true;
  return String(license.status ?? "").toLowerCase() === "trial";
}

export function publicTrialCtaLabel(trialDays: number, trialEnabled: boolean): string {
  if (!trialEnabled || trialDays < 1) return "Vyzkoušet RAJMONDATA";
  return `Vyzkoušet RAJMONDATA ${trialDays} dní zdarma`;
}
