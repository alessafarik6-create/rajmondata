import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
} from "@/lib/firestore-collections";
import { ensureCompanyLicenseDoc } from "@/lib/company-license-admin";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { editorUrlsFromCatalog } from "@/lib/rajmondata-editor/config";
import {
  canOrganizationUseModule,
  canUserUseModuleWithSeats,
} from "@/lib/rajmondata-editor/module-access";
import { resolveEffectiveModuleAssignedUserIds } from "@/lib/external-module-portal";
import { requestEditorLaunchTicket } from "@/lib/rajmondata-editor/editor-api-client.server";
import { listModuleUserAssignmentIds } from "@/lib/platform-module-assignments.server";

export async function launchExternalModuleForUser(input: {
  db: Firestore;
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  displayName: string;
  moduleCode: PlatformModuleCode;
  portalRole?: string;
  firebaseIdToken: string;
}): Promise<
  | { ok: true; redirectUrl: string; mode: "editor_api" }
  | { ok: false; status: number; error: string }
> {
  if (input.organizationId !== input.organizationId.trim()) {
    return { ok: false, status: 400, error: "Neplatná organizace." };
  }

  const modSnap = await input.db.collection(PLATFORM_MODULES_COLLECTION).doc(input.moduleCode).get();
  const catalog = buildMergedPlatformCatalogMap(
    modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
  )[input.moduleCode];
  if (!catalog || catalog.activeGlobally === false) {
    return { ok: false, status: 403, error: "Modul není globálně dostupný." };
  }

  const license = await ensureCompanyLicenseDoc(input.db, input.organizationId);
  if (license.companyId && license.companyId !== input.organizationId) {
    return { ok: false, status: 403, error: "Neshoda licence organizace." };
  }

  const orgDecision = canOrganizationUseModule(license, input.moduleCode);

  const licSnap = await input.db.collection(COMPANY_LICENSES_COLLECTION).doc(input.organizationId).get();
  const licPending = licSnap.data() as {
    editorAccessSyncPending?: boolean;
    editorAccessSyncLastError?: string | null;
  } | undefined;
  if (licPending?.editorAccessSyncPending && !orgDecision.ok) {
    return {
      ok: false,
      status: 503,
      error:
        licPending.editorAccessSyncLastError ||
        "Synchronizace oprávnění s editorem neproběhla — spuštění je dočasně blokováno.",
    };
  }

  const assigned = await listModuleUserAssignmentIds(
    input.db,
    input.organizationId,
    input.moduleCode
  );
  const ent = license.modules[input.moduleCode];
  const seatCount = ent?.seatCount ?? catalog.defaultSeatCount ?? 1;
  const assignedEffective = resolveEffectiveModuleAssignedUserIds({
    assignedUserIds: assigned,
    licenseModel: catalog.licenseModel ?? "organization",
    portalRole: input.portalRole,
    userId: input.userId,
  });
  const userDecision = canUserUseModuleWithSeats({
    orgDecision,
    licenseModel: catalog.licenseModel ?? "organization",
    assignedUserIds: assignedEffective,
    userId: input.userId,
    seatCount,
  });
  if (!userDecision.ok) {
    const msg =
      userDecision.reason === "not_assigned"
        ? "Nemáte přidělenou uživatelskou licenci k tomuto modulu."
        : userDecision.reason === "expired"
          ? "Licence modulu vypršela."
          : "Modul není pro vaši organizaci aktivní.";
    return { ok: false, status: 403, error: msg };
  }

  const { apiUrl, appUrl } = editorUrlsFromCatalog(catalog);
  const moduleActive = orgDecision.ok;
  const billingRequired = catalog.isPaid === true;
  const licenseActive = billingRequired
    ? orgDecision.ok &&
      ent?.paymentStatus !== "suspended" &&
      ent?.tenantModuleStatus !== "suspended"
    : orgDecision.ok;

  const editorRes = await requestEditorLaunchTicket({
    apiUrl,
    idToken: input.firebaseIdToken,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    moduleActive,
    licenseActive,
  });

  if (!editorRes.ok) {
    return { ok: false, status: editorRes.status, error: editorRes.error };
  }

  const redirectUrl = `${appUrl.replace(/\/$/, "")}/launch#ticket=${encodeURIComponent(editorRes.data.ticket)}`;

  await input.db.collection(PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION).add({
    organizationId: input.organizationId,
    userId: input.userId,
    moduleCode: input.moduleCode,
    mode: "editor_api_v1",
    at: FieldValue.serverTimestamp(),
  });

  return { ok: true, redirectUrl, mode: "editor_api" };
}
