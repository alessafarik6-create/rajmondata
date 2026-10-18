import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import {
  COMPANY_LICENSES_COLLECTION,
  PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from "@/lib/firestore-collections";
import { PLATFORM_MODULE_CODES, isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import { effectiveModulePriceCzk } from "@/lib/rajmondata-editor/module-access";
import { listModuleUserAssignmentIds } from "@/lib/platform-module-assignments.server";

export type ModuleStatsRow = {
  moduleCode: PlatformModuleCode;
  organizationsActive: number;
  organizationsTrial: number;
  organizationsExpired: number;
  organizationsPaid: number;
  userAssignments: number;
  launchCount: number;
  mrrCzk: number;
  arrCzk: number;
  lastActivityAt: string | null;
};

export async function computePlatformModuleStats(db: Firestore): Promise<ModuleStatsRow[]> {
  const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).get();
  const catalog = buildMergedPlatformCatalogMap(
    modSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  );
  const licSnap = await db.collection(COMPANY_LICENSES_COLLECTION).get();
  const licenses = licSnap.docs.map((d) => d.data() as CompanyLicenseDoc);

  const launchSnap = await db.collection(PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION).limit(5000).get();

  const launchByModule = new Map<string, { count: number; lastAt: string | null }>();
  if (launchSnap) {
    for (const doc of launchSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const code = String(d.moduleCode ?? "");
      if (!code) continue;
      const prev = launchByModule.get(code) ?? { count: 0, lastAt: null };
      prev.count += 1;
      launchByModule.set(code, prev);
    }
  }

  const rows: ModuleStatsRow[] = [];
  for (const code of PLATFORM_MODULE_CODES) {
    let organizationsActive = 0;
    let organizationsTrial = 0;
    let organizationsExpired = 0;
    let organizationsPaid = 0;
    let mrr = 0;
    let userAssignments = 0;

    for (const lic of licenses) {
      const ent = lic.modules?.[code];
      if (!ent) continue;
      if (ent.isTrial && isModuleEntitlementActiveNow(ent)) organizationsTrial += 1;
      else if (isModuleEntitlementActiveNow(ent)) organizationsActive += 1;
      else if (ent.expiresAt) organizationsExpired += 1;
      if (ent.paymentStatus === "paid" && isModuleEntitlementActiveNow(ent)) {
        organizationsPaid += 1;
        const price = effectiveModulePriceCzk(ent, catalog[code], "monthly");
        mrr += price;
      }
    }

    if (catalog[code]?.licenseModel === "per_user" || catalog[code]?.licenseModel === "org_seats") {
      for (const lic of licenses) {
        const ent = lic.modules?.[code];
        if (!ent?.active) continue;
        const ids = await listModuleUserAssignmentIds(db, lic.companyId, code);
        userAssignments += ids.length;
      }
    }

    const launchMeta = launchByModule.get(code);
    rows.push({
      moduleCode: code,
      organizationsActive,
      organizationsTrial,
      organizationsExpired,
      organizationsPaid,
      userAssignments,
      launchCount: launchMeta?.count ?? 0,
      mrrCzk: Math.round(mrr),
      arrCzk: Math.round(mrr * 12),
      lastActivityAt: launchMeta?.lastAt ?? null,
    });
  }
  return rows;
}
