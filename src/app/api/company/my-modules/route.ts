import { NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { ensureCompanyLicenseDoc } from "@/lib/company-license-admin";
import { PLATFORM_MODULES_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import { effectiveModulePriceCzk } from "@/lib/rajmondata-editor/module-access";
import { listModuleUserAssignmentIds } from "@/lib/platform-module-assignments.server";
import { resolveExternalModulePortalState } from "@/lib/external-module-portal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).get();
  const catalog = buildMergedPlatformCatalogMap(
    modSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  );
  const license = await ensureCompanyLicenseDoc(db, v.caller.companyId);

  const modules = [];
  for (const code of PLATFORM_MODULE_CODES) {
    const row = catalog[code];
    if (!row?.activeGlobally) continue;
    if (row.moduleKind !== "external") continue;
    const ent = license.modules[code];
    const assigned = await listModuleUserAssignmentIds(db, v.caller.companyId, code);
    const portal = resolveExternalModulePortalState({
      moduleCode: code,
      catalog: row,
      license,
      userId: v.caller.uid,
      portalRole: v.caller.role,
      assignedUserIds: assigned,
    });

    modules.push({
      code,
      externalId: row.externalId,
      name: row.name,
      description: row.description,
      iconKey: row.iconKey,
      category: row.category,
      licenseModel: row.licenseModel,
      active: portal.userCanLaunch,
      userCanLaunch: portal.userCanLaunch,
      orgLicensed: portal.orgLicensed,
      billingRequired: portal.billingRequired,
      statusLabel: portal.statusLabel,
      showSubscriptionOrder: portal.showSubscriptionOrder,
      isGloballyFree: !portal.billingRequired,
      userAssigned: portal.userCanLaunch || assigned.includes(v.caller.uid),
      isTrial: Boolean(ent?.isTrial),
      expiresAt: ent?.expiresAt ?? null,
      paymentStatus: ent?.paymentStatus ?? (row.isPaid ? "unpaid" : "free"),
      priceMonthlyCzk: effectiveModulePriceCzk(ent, row, "monthly"),
      priceYearlyCzk: effectiveModulePriceCzk(ent, row, "yearly"),
      seatCount: ent?.seatCount ?? row.defaultSeatCount ?? 1,
      assignedUsers: assigned.length,
      trialDays: row.trialDays ?? 0,
      integrationStatus: row.integrationStatus ?? "unknown",
      launchPath: `/portal/modules/${code}`,
    });
  }

  return NextResponse.json({ ok: true, modules });
}
