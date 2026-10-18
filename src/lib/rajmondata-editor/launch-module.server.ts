import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from "@/lib/firestore-collections";
import { ensureCompanyLicenseDoc } from "@/lib/company-license-admin";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { editorUrlsFromCatalog } from "@/lib/rajmondata-editor/config";
import {
  canOrganizationUseModule,
  canUserUseModuleWithSeats,
} from "@/lib/rajmondata-editor/module-access";
import { requestEditorLaunchTicket } from "@/lib/rajmondata-editor/editor-api-client.server";
import { createPortalLaunchTicket } from "@/lib/rajmondata-editor/launch-tickets.server";
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
}): Promise<
  | { ok: true; redirectUrl: string; mode: "editor_api" | "portal_ticket" }
  | { ok: false; status: number; error: string }
> {
  const modSnap = await input.db.collection(PLATFORM_MODULES_COLLECTION).doc(input.moduleCode).get();
  const catalog = buildMergedPlatformCatalogMap(
    modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
  )[input.moduleCode];
  if (!catalog || catalog.activeGlobally === false) {
    return { ok: false, status: 403, error: "Modul není globálně dostupný." };
  }

  const license = await ensureCompanyLicenseDoc(input.db, input.organizationId);
  const orgDecision = canOrganizationUseModule(license, input.moduleCode);
  const assigned = await listModuleUserAssignmentIds(
    input.db,
    input.organizationId,
    input.moduleCode
  );
  const ent = license.modules[input.moduleCode];
  const seatCount = ent?.seatCount ?? catalog.defaultSeatCount ?? 1;
  let assignedEffective = assigned;
  if (
    (catalog.licenseModel === "org_seats" || catalog.licenseModel === "per_user") &&
    assignedEffective.length === 0 &&
    (input.portalRole === "owner" || input.portalRole === "admin")
  ) {
    assignedEffective = [input.userId];
  }
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

  const editorRes = await requestEditorLaunchTicket({
    apiUrl,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    moduleCode: input.moduleCode,
  });

  let redirectUrl: string;
  let mode: "editor_api" | "portal_ticket";

  if (editorRes.ok) {
    redirectUrl = editorRes.data.consumeUrl;
    mode = "editor_api";
  } else if (editorRes.status === 404 || editorRes.status === 501) {
    const portalTicket = await createPortalLaunchTicket(input.db, {
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      moduleCode: input.moduleCode,
    });
    redirectUrl = `${appUrl.replace(/\/$/, "")}/auth/portal/launch?ticket=${encodeURIComponent(portalTicket.ticketId)}`;
    mode = "portal_ticket";
  } else {
    return { ok: false, status: editorRes.status, error: editorRes.error };
  }

  await input.db.collection(PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION).add({
    organizationId: input.organizationId,
    userId: input.userId,
    moduleCode: input.moduleCode,
    mode,
    at: FieldValue.serverTimestamp(),
  });

  return { ok: true, redirectUrl, mode };
}
