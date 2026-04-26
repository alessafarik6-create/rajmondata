/**
 * Aktivace modulů přes platformní fakturu (`source: moduleActivation`) + 48h grace po „Zaplatil jsem“.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_INVOICES_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from "@/lib/firestore-collections";
import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { buildMergedPlatformCatalogMap, type PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { computeEffectivePlatformInvoiceStatus } from "@/lib/platform-billing";
import { ensureCompanyLicenseDoc, writeCompanyLicenseAndDenorm } from "@/lib/company-license-admin";
import { emptyModuleEntitlement } from "@/lib/company-license-record";
import { countBillableCompanyEmployees } from "@/lib/platform-invoice-auto";
import { PLATFORM_PAYMENT_GRACE_MS, firestoreTimestampToMillis } from "@/lib/platform-invoice-payment-server";

function isPlatformModuleCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

async function loadModuleCatalogRow(
  db: Firestore,
  code: PlatformModuleCode
): Promise<PlatformModuleCatalogRow> {
  const snap = await db.collection(PLATFORM_MODULES_COLLECTION).doc(code).get();
  const docs = snap.exists ? [{ id: snap.id, ...(snap.data() as Record<string, unknown>) }] : [];
  return buildMergedPlatformCatalogMap(docs)[code];
}

export async function assertNoOpenModuleActivationInvoice(
  db: Firestore,
  organizationId: string,
  moduleId: PlatformModuleCode
): Promise<void> {
  const orgId = String(organizationId || "").trim();
  const snap = await db
    .collection(PLATFORM_INVOICES_COLLECTION)
    .where("organizationId", "==", orgId)
    .where("source", "==", "moduleActivation")
    .where("moduleId", "==", moduleId)
    .limit(25)
    .get();
  for (const d of snap.docs) {
    const data = (d.data() ?? {}) as Record<string, unknown>;
    const st = String(data.status || "unpaid");
    if (st === "paid" || st === "cancelled" || st === "canceled") continue;
    const eff = computeEffectivePlatformInvoiceStatus(st, data.dueDate as string);
    if (eff === "paid" || eff === "cancelled") continue;
    throw new Error("Pro tento modul už existuje neuhrazená aktivační faktura.");
  }
}

export async function buildModuleActivationLineInput(
  db: Firestore,
  organizationId: string,
  moduleId: PlatformModuleCode
): Promise<{
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  vatRate: number;
  moduleName: string;
}> {
  const row = await loadModuleCatalogRow(db, moduleId);
  const name = row.name;
  if (row.isPaid === false || (!row.priceMonthly && moduleId !== "attendance_payroll")) {
    // attendance může mít 0 base ale placený per employee — necháme výpočet
    if (!(moduleId === "attendance_payroll" && row.billingType === "per_employee")) {
      throw new Error("Tento modul je v ceníku označen jako neplacený — aktivace přes fakturu není potřeba.");
    }
  }

  let quantity = 1;
  let unit = "měs.";
  let unitPriceNet = Number(row.priceMonthly || row.basePriceCzk || 0);

  if (row.billingType === "per_employee" && moduleId === "attendance_payroll") {
    const ec = await countBillableCompanyEmployees(db, organizationId);
    quantity = Math.max(1, ec);
    unit = "osoba";
    unitPriceNet = Number(row.employeePriceCzk ?? 0);
  }

  if (!Number.isFinite(unitPriceNet) || unitPriceNet < 0) unitPriceNet = 0;

  return {
    description: `Aktivace modulu: ${name}`,
    quantity,
    unit,
    unitPriceNet,
    vatRate: 21,
    moduleName: name,
  };
}

export async function applyModuleActivationGraceAdmin(input: {
  db: Firestore;
  organizationId: string;
  moduleId: string;
  graceUntilMs: number;
}): Promise<void> {
  const orgId = String(input.organizationId || "").trim();
  const code = String(input.moduleId || "").trim();
  if (!orgId || !isPlatformModuleCode(code)) {
    throw new Error("Neplatný modul.");
  }
  const graceIso = new Date(input.graceUntilMs).toISOString();
  const db = input.db;
  let lic = await ensureCompanyLicenseDoc(db, orgId);
  const prev = lic.modules[code] ?? emptyModuleEntitlement(code);
  const nextMod = {
    ...prev,
    moduleCode: code,
    active: true,
    activatedAt: new Date().toISOString(),
    expiresAt: null,
    tenantModuleStatus: "pendingConfirmation" as const,
    gracePeriodUntilIso: graceIso,
    confirmedAtIso: null,
  };
  const enabledModules: PlatformModuleCode[] = [...new Set([...lic.enabledModules, code])];
  lic = {
    ...lic,
    modules: { ...lic.modules, [code]: nextMod },
    enabledModules,
  };
  await writeCompanyLicenseAndDenorm(db, orgId, lic);
}

export async function confirmModuleActivationPaidAdmin(
  db: Firestore,
  organizationId: string,
  moduleId: string
): Promise<void> {
  const orgId = String(organizationId || "").trim();
  const code = String(moduleId || "").trim();
  if (!orgId || !isPlatformModuleCode(code)) {
    throw new Error("Neplatný modul.");
  }
  let lic = await ensureCompanyLicenseDoc(db, orgId);
  const prev = lic.modules[code] ?? emptyModuleEntitlement(code);
  const nextMod = {
    ...prev,
    moduleCode: code,
    active: true,
    tenantModuleStatus: "active" as const,
    gracePeriodUntilIso: null,
    confirmedAtIso: new Date().toISOString(),
    expiresAt: null,
  };
  const enabledModules: PlatformModuleCode[] = [...new Set([...lic.enabledModules, code])];
  lic = {
    ...lic,
    modules: { ...lic.modules, [code]: nextMod },
    enabledModules,
  };
  await writeCompanyLicenseAndDenorm(db, orgId, lic);
}

export async function suspendModuleActivationAfterGraceAdmin(
  db: Firestore,
  organizationId: string,
  moduleId: string
): Promise<void> {
  const orgId = String(organizationId || "").trim();
  const code = String(moduleId || "").trim();
  if (!orgId || !isPlatformModuleCode(code)) {
    throw new Error("Neplatný modul.");
  }
  let lic = await ensureCompanyLicenseDoc(db, orgId);
  const prev = lic.modules[code] ?? emptyModuleEntitlement(code);
  const nextMod = {
    ...prev,
    moduleCode: code,
    active: false,
    tenantModuleStatus: "suspended" as const,
    gracePeriodUntilIso: null,
    confirmedAtIso: null,
    expiresAt: null,
  };
  const enabledModules = lic.enabledModules.filter((c) => c !== code);
  lic = {
    ...lic,
    modules: { ...lic.modules, [code]: nextMod },
    enabledModules,
  } as CompanyLicenseDoc;
  await writeCompanyLicenseAndDenorm(db, orgId, lic);
}

export async function deactivateModuleAfterExpiredActivationGraceAdmin(
  db: Firestore,
  invoiceId: string,
  invoice: Record<string, unknown>
): Promise<boolean> {
  if (String(invoice.source || "") !== "moduleActivation") return false;
  const moduleId = String(invoice.moduleId || "").trim();
  const orgId = String(invoice.organizationId || "").trim();
  if (!moduleId || !orgId || !isPlatformModuleCode(moduleId)) return false;

  const graceMs = firestoreTimestampToMillis(invoice.gracePeriodUntil);
  if (graceMs == null || graceMs > Date.now()) return false;
  if (invoice.paymentClaimed !== true) return false;
  const st = String(invoice.status || "unpaid");
  if (st === "paid" || st === "cancelled" || st === "canceled") return false;

  await suspendModuleActivationAfterGraceAdmin(db, orgId, moduleId);
  await db.collection(PLATFORM_INVOICES_COLLECTION).doc(invoiceId).set(
    {
      graceDeactivationApplied: true,
      graceDeactivatedAt: FieldValue.serverTimestamp(),
      moduleGraceDeactivated: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}
