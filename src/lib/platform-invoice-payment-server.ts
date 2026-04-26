/**
 * Platby faktur provozovatele — oznámení „Zaplatil jsem“, lhůta 48 h, automatická deaktivace.
 */
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  PLATFORM_INVOICES_COLLECTION,
} from "@/lib/firestore-collections";
import {
  computeEffectivePlatformInvoiceStatus,
  listPlatformInvoicesForOrganization,
} from "@/lib/platform-billing";

export const PLATFORM_PAYMENT_GRACE_MS = 48 * 60 * 60 * 1000;

export function firestoreTimestampToMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof (v as { toMillis?: () => number }).toMillis === "function") {
    const n = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    const d = (v as { toDate: () => Date }).toDate();
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function graceUntilFromClaimedAt(claimedAt: Timestamp): Timestamp {
  return Timestamp.fromMillis(claimedAt.toMillis() + PLATFORM_PAYMENT_GRACE_MS);
}

/** Nejnovější neuhrazená faktura (podle createdAt desc z listu). */
export function pickLatestUnpaidPlatformInvoiceId(
  rows: Array<Record<string, unknown> & { id: string; displayStatus: string }>
): string | null {
  for (const r of rows) {
    const st = String(r.status || "unpaid");
    if (st === "paid" || st === "cancelled" || st === "canceled") continue;
    const eff = r.displayStatus || computeEffectivePlatformInvoiceStatus(st, r.dueDate as string);
    if (eff === "paid" || eff === "cancelled") continue;
    return r.id;
  }
  return null;
}

export async function claimPlatformInvoicePaymentAdmin(input: {
  db: Firestore;
  organizationId: string;
  invoiceId: string;
  actorUid: string;
}): Promise<
  | { ok: true; gracePeriodUntilIso: string; alreadyClaimed: boolean }
  | { ok: false; status: number; error: string }
> {
  const { db, organizationId, invoiceId, actorUid } = input;
  const orgId = String(organizationId || "").trim();
  const invId = String(invoiceId || "").trim();
  if (!orgId || !invId) {
    return { ok: false, status: 400, error: "Chybí organizationId nebo invoiceId." };
  }

  const rows = await listPlatformInvoicesForOrganization(db, orgId);
  const latestUnpaid = pickLatestUnpaidPlatformInvoiceId(rows);
  if (!latestUnpaid || latestUnpaid !== invId) {
    return {
      ok: false,
      status: 400,
      error: "Platbu lze oznámit jen u poslední neuhrazené faktury.",
    };
  }

  const ref = db.collection(PLATFORM_INVOICES_COLLECTION).doc(invId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Faktura neexistuje." };
  }
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (String(data.organizationId || "").trim() !== orgId) {
    return { ok: false, status: 403, error: "Faktura nepatří této organizaci." };
  }
  const st = String(data.status || "unpaid");
  if (st === "paid" || st === "cancelled" || st === "canceled") {
    return { ok: false, status: 400, error: "Faktura není ve stavu k úhradě." };
  }

  const claimed = data.paymentClaimed === true;
  const graceMs = firestoreTimestampToMillis(data.gracePeriodUntil);
  if (claimed && graceMs != null && graceMs > Date.now()) {
    return {
      ok: true,
      alreadyClaimed: true,
      gracePeriodUntilIso: new Date(graceMs).toISOString(),
    };
  }

  const paymentClaimedAt = Timestamp.now();
  const gracePeriodUntil = graceUntilFromClaimedAt(paymentClaimedAt);
  await ref.set(
    {
      paymentClaimed: true,
      paymentClaimedAt,
      gracePeriodUntil,
      paymentClaimedByUid: actorUid,
      graceDeactivationApplied: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return {
    ok: true,
    alreadyClaimed: false,
    gracePeriodUntilIso: gracePeriodUntil.toDate().toISOString(),
  };
}

export async function processExpiredPlatformPaymentGraceAdmin(db: Firestore): Promise<{
  scanned: number;
  deactivated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let deactivated = 0;
  const snap = await db
    .collection(PLATFORM_INVOICES_COLLECTION)
    .where("paymentClaimed", "==", true)
    .limit(200)
    .get();

  const now = Date.now();
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    try {
      const st = String(data.status || "unpaid");
      if (st === "paid" || st === "cancelled" || st === "canceled") continue;
      if (data.graceDeactivationApplied === true) continue;
      const graceMs = firestoreTimestampToMillis(data.gracePeriodUntil);
      if (graceMs == null || graceMs > now) continue;

      const orgId = String(data.organizationId || "").trim();
      if (!orgId) continue;

      const suspension = {
        reason: "payment_grace_expired" as const,
        invoiceId: doc.id,
        at: FieldValue.serverTimestamp(),
      };
      const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(orgId);
      const compRef = db.collection(COMPANIES_COLLECTION).doc(orgId);
      const [orgSnap, compSnap] = await Promise.all([orgRef.get(), compRef.get()]);
      const orgLic = (orgSnap.data()?.license as Record<string, unknown> | undefined) ?? {};
      const compLic = (compSnap.data()?.license as Record<string, unknown> | undefined) ?? {};
      const licenseSuspended = {
        ...orgLic,
        status: "suspended",
        licenseStatus: "suspended",
      };
      const patch = {
        isActive: false,
        active: false,
        licenseActive: false,
        license: licenseSuspended,
        platformBillingSuspension: suspension,
        updatedAt: new Date(),
      };
      await orgRef.set(patch, { merge: true });
      await compRef.set(
        {
          ...patch,
          license: { ...compLic, status: "suspended", licenseStatus: "suspended" },
        },
        { merge: true }
      );
      await doc.ref.set(
        {
          graceDeactivationApplied: true,
          graceDeactivatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      deactivated += 1;
    } catch (e) {
      errors.push(`${doc.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { scanned: snap.docs.length, deactivated, errors };
}

export type PlatformBillingClientSummary = {
  hasUnpaidEffective: boolean;
  paymentClaimActive: boolean;
  gracePeriodUntilIso: string | null;
  graceMsRemaining: number;
  accountSuspendedForPayment: boolean;
};

export function computePlatformBillingClientSummary(input: {
  rows: Array<Record<string, unknown> & { id: string; displayStatus: string }>;
  companyIsActive: boolean;
  platformBillingSuspension: unknown;
}): PlatformBillingClientSummary {
  let hasUnpaidEffective = false;
  let paymentClaimActive = false;
  let gracePeriodUntilIso: string | null = null;
  let graceMsRemaining = 0;
  const now = Date.now();

  for (const r of input.rows) {
    const st = String(r.status || "unpaid");
    const eff =
      (r.displayStatus as string) ||
      computeEffectivePlatformInvoiceStatus(st, r.dueDate as string);
    if (eff === "unpaid" || eff === "overdue") hasUnpaidEffective = true;

    if (r.paymentClaimed === true) {
      const ms = firestoreTimestampToMillis(r.gracePeriodUntil);
      if (ms != null && ms > now) {
        paymentClaimActive = true;
        const rem = ms - now;
        if (rem > graceMsRemaining) {
          graceMsRemaining = rem;
          gracePeriodUntilIso = new Date(ms).toISOString();
        }
      }
    }
  }

  const susp = input.platformBillingSuspension;
  const suspReason =
    susp && typeof susp === "object"
      ? String((susp as { reason?: string }).reason || "").trim()
      : "";
  const accountSuspendedForPayment =
    input.companyIsActive === false && suspReason === "payment_grace_expired";

  return {
    hasUnpaidEffective,
    paymentClaimActive,
    gracePeriodUntilIso,
    graceMsRemaining,
    accountSuspendedForPayment,
  };
}
