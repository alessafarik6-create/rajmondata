import type { Firestore } from "firebase-admin/firestore";
import type { CompanyLicenseDoc } from "@/lib/platform-config";
import {
  buildTrialCompanyLicense,
  remainingTrialDays,
  trialEndsAtFromStart,
} from "@/lib/platform-subscription";
import { loadPlatformPricingDoc } from "@/lib/platform-invoice-auto";
import {
  ensureCompanyLicenseDoc,
  writeCompanyLicenseAndDenorm,
} from "@/lib/company-license-admin";
import { logPlatformLicenseAudit } from "@/lib/platform-license-audit";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function applyRegistrationTrialIfEligible(
  db: Firestore,
  companyId: string,
  actorUid: string
): Promise<{ ok: true; applied: boolean; reason?: string } | { ok: false; error: string }> {
  const pricing = await loadPlatformPricingDoc(db);
  if (!pricing.trialEnabled) {
    return { ok: true, applied: false, reason: "trial_disabled" };
  }

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  if (!companySnap.exists) {
    return { ok: false, error: "company_not_found" };
  }
  const company = companySnap.data() as Record<string, unknown>;
  const ownerId = String(company.ownerId ?? company.ownerUserId ?? "");
  if (ownerId && ownerId !== actorUid) {
    return { ok: false, error: "forbidden" };
  }
  if (company.trialConsumed === true) {
    return { ok: true, applied: false, reason: "trial_already_used" };
  }

  const lic = await ensureCompanyLicenseDoc(db, companyId);
  if (lic.trialConsumed || lic.subscriptionStatus === "TRIAL") {
    return { ok: true, applied: false, reason: "trial_already_active" };
  }
  if (lic.subscriptionStatus === "ACTIVE" && lic.status === "active" && lic.active) {
    return { ok: true, applied: false, reason: "already_paid" };
  }

  const before = { ...lic };
  const next = buildTrialCompanyLicense(lic, pricing.trialDays);
  await writeCompanyLicenseAndDenorm(db, companyId, next, {
    organizationDenormPatch: {
      active: true,
      isActive: true,
      trialConsumed: true,
    },
  });

  await logPlatformLicenseAudit(db, {
    companyId,
    action: "trial_started_registration",
    actor: actorUid,
    before: before as unknown as Record<string, unknown>,
    after: next as unknown as Record<string, unknown>,
    note: `Zkušební období ${pricing.trialDays} dní`,
  });

  return { ok: true, applied: true };
}

export type SuperadminTrialAction =
  | { action: "set_trial_end"; trialEndsAt: string }
  | { action: "extend_trial"; extraDays: number }
  | { action: "end_trial" }
  | { action: "convert_to_paid" };

export async function applySuperadminTrialAction(
  db: Firestore,
  companyId: string,
  payload: SuperadminTrialAction,
  actor: string
): Promise<CompanyLicenseDoc> {
  const lic = await ensureCompanyLicenseDoc(db, companyId);
  const before = { ...lic };
  let next: CompanyLicenseDoc = { ...lic };
  const nowIso = new Date().toISOString();

  switch (payload.action) {
    case "set_trial_end": {
      const end = payload.trialEndsAt.trim();
      next = {
        ...next,
        subscriptionStatus: "TRIAL",
        status: "trial",
        active: true,
        trialEndsAt: end,
        expiresAt: end,
        trialStartedAt: next.trialStartedAt ?? nowIso,
        trialConsumed: true,
      };
      await logPlatformLicenseAudit(db, {
        companyId,
        action: "trial_end_changed",
        actor,
        before: before as unknown as Record<string, unknown>,
        after: next as unknown as Record<string, unknown>,
      });
      break;
    }
    case "extend_trial": {
      const base = next.trialEndsAt ?? next.expiresAt ?? nowIso;
      const end = trialEndsAtFromStart(base, payload.extraDays);
      next = {
        ...next,
        subscriptionStatus: "TRIAL",
        status: "trial",
        active: true,
        trialEndsAt: end,
        expiresAt: end,
        trialStartedAt: next.trialStartedAt ?? nowIso,
        trialConsumed: true,
      };
      await logPlatformLicenseAudit(db, {
        companyId,
        action: "trial_extended",
        actor,
        before: before as unknown as Record<string, unknown>,
        after: next as unknown as Record<string, unknown>,
        note: `+${payload.extraDays} dní`,
      });
      break;
    }
    case "end_trial": {
      next = {
        ...next,
        subscriptionStatus: "EXPIRED",
        status: "expired",
        active: false,
      };
      await logPlatformLicenseAudit(db, {
        companyId,
        action: "trial_ended",
        actor,
        before: before as unknown as Record<string, unknown>,
        after: next as unknown as Record<string, unknown>,
      });
      break;
    }
    case "convert_to_paid": {
      next = {
        ...next,
        subscriptionStatus: "ACTIVE",
        status: "active",
        active: true,
        trialEndsAt: next.trialEndsAt,
      };
      await logPlatformLicenseAudit(db, {
        companyId,
        action: "trial_converted_paid",
        actor,
        before: before as unknown as Record<string, unknown>,
        after: next as unknown as Record<string, unknown>,
      });
      break;
    }
    default:
      throw new Error("unknown_action");
  }

  await writeCompanyLicenseAndDenorm(db, companyId, next, {
    organizationDenormPatch: {
      active: next.active,
      isActive: next.active,
      trialConsumed: next.trialConsumed ?? before.trialConsumed ?? false,
    },
  });
  return next;
}

export function trialReminderDaysRemaining(trialEndsAt: string | null | undefined): number {
  return remainingTrialDays(trialEndsAt);
}
