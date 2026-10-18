import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import {
  canOrganizationUseModule,
  canUserUseModuleWithSeats,
  type ModuleAccessDecision,
} from "@/lib/rajmondata-editor/module-access";

export type ExternalModulePortalState = {
  moduleCode: PlatformModuleCode;
  orgLicensed: boolean;
  userCanLaunch: boolean;
  billingRequired: boolean;
  statusLabel: string;
  showSubscriptionOrder: boolean;
  showPaymentUiOnModuleCard: boolean;
  orgDecision: ModuleAccessDecision;
  userDecision: ModuleAccessDecision;
};

/** Stejná logika jako při spuštění — owner/admin bez explicitního přiřazení u org_seats. */
export function resolveEffectiveModuleAssignedUserIds(input: {
  assignedUserIds: string[];
  licenseModel: PlatformModuleCatalogRow["licenseModel"];
  portalRole?: string;
  userId: string;
}): string[] {
  const ids = [...input.assignedUserIds];
  const role = String(input.portalRole ?? "").toLowerCase();
  if (
    (input.licenseModel === "org_seats" || input.licenseModel === "per_user") &&
    ids.length === 0 &&
    (role === "owner" || role === "admin")
  ) {
    return [input.userId];
  }
  return ids;
}

export function buildExternalModuleStatusLabel(input: {
  userCanLaunch: boolean;
  billingRequired: boolean;
  orgDecision: ModuleAccessDecision;
}): string {
  if (!input.userCanLaunch) return "Neaktivní";
  if (!input.billingRequired) return "Aktivní – zdarma";
  if (input.orgDecision.ok && input.orgDecision.reason === "trial") return "Zkušební";
  if (input.orgDecision.ok && input.orgDecision.reason === "grace") {
    return "Dočasně aktivní (čeká potvrzení platby)";
  }
  return "Aktivní";
}

export function resolveExternalModulePortalState(input: {
  moduleCode: PlatformModuleCode;
  catalog: PlatformModuleCatalogRow;
  license: CompanyLicenseDoc;
  userId: string;
  portalRole?: string;
  assignedUserIds: string[];
  /** Neuhrazená faktura aktivace modulu (jen informativně u placených). */
  hasOpenModuleActivationInvoice?: boolean;
}): ExternalModulePortalState {
  const orgDecision = canOrganizationUseModule(input.license, input.moduleCode);
  const billingRequired = input.catalog.isPaid === true;
  const ent = input.license.modules[input.moduleCode];
  const seatCount = ent?.seatCount ?? input.catalog.defaultSeatCount ?? 1;
  const assignedEffective = resolveEffectiveModuleAssignedUserIds({
    assignedUserIds: input.assignedUserIds,
    licenseModel: input.catalog.licenseModel ?? "organization",
    portalRole: input.portalRole,
    userId: input.userId,
  });
  const userDecision = canUserUseModuleWithSeats({
    orgDecision,
    licenseModel: input.catalog.licenseModel ?? "organization",
    assignedUserIds: assignedEffective,
    userId: input.userId,
    seatCount,
  });

  const orgLicensed = orgDecision.ok;
  const userCanLaunch = userDecision.ok;
  const statusLabel = buildExternalModuleStatusLabel({
    userCanLaunch,
    billingRequired,
    orgDecision,
  });

  const showSubscriptionOrder = billingRequired && !orgLicensed;
  const showPaymentUiOnModuleCard =
    billingRequired &&
    !userCanLaunch &&
    Boolean(input.hasOpenModuleActivationInvoice);

  return {
    moduleCode: input.moduleCode,
    orgLicensed,
    userCanLaunch,
    billingRequired,
    statusLabel,
    showSubscriptionOrder,
    showPaymentUiOnModuleCard,
    orgDecision,
    userDecision,
  };
}

export function externalModulePortalPath(code: PlatformModuleCode): string {
  return `/portal/modules/${encodeURIComponent(code)}`;
}

export function isExternalModuleEligibleForPortalNav(
  code: PlatformModuleCode,
  row: PlatformModuleCatalogRow | undefined
): boolean {
  if (!row) return false;
  if (row.moduleKind !== "external") return false;
  if (row.activeGlobally === false) return false;
  const show = (row as PlatformModuleCatalogRow & { showInPortalNav?: boolean }).showInPortalNav;
  if (show === false) return false;
  return true;
}
