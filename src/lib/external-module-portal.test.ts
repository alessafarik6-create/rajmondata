import {
  buildExternalModuleStatusLabel,
  resolveEffectiveModuleAssignedUserIds,
  resolveExternalModulePortalState,
} from "@/lib/external-module-portal";
import type { CompanyLicenseDoc } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";

const freeCatalog: PlatformModuleCatalogRow = {
  activeGlobally: true,
  defaultEnabled: false,
  name: "Editor",
  description: "",
  basePriceCzk: 0,
  priceMonthly: 0,
  currency: "CZK",
  billingPeriod: "monthly",
  isPaid: false,
  billingType: "per_company",
  configurableBySuperadmin: true,
  moduleKind: "external",
  licenseModel: "org_seats",
  defaultSeatCount: 3,
};

const license = (active: boolean): CompanyLicenseDoc =>
  ({
    companyId: "org1",
    active: true,
    status: "active",
    enabledModules: ["rajmondata_editor"],
    modules: {
      rajmondata_editor: {
        moduleCode: "rajmondata_editor",
        active,
        activatedAt: new Date().toISOString(),
        expiresAt: null,
        customPriceCzk: null,
        paymentStatus: "free",
        tenantModuleStatus: "active",
      },
    },
    pricingSnapshot: {},
    employeePricing: {
      perEmployeeCzk: 0,
      moduleCode: "attendance_payroll",
      lastEmployeeCount: 0,
      monthlyModuleCzk: 0,
    },
  }) as unknown as CompanyLicenseDoc;

console.assert(
  resolveEffectiveModuleAssignedUserIds({
    assignedUserIds: [],
    licenseModel: "org_seats",
    portalRole: "owner",
    userId: "u1",
  }).includes("u1"),
  "owner implicit seat"
);

const freeState = resolveExternalModulePortalState({
  moduleCode: "rajmondata_editor",
  catalog: freeCatalog,
  license: license(true),
  userId: "u1",
  portalRole: "owner",
  assignedUserIds: [],
  hasOpenModuleActivationInvoice: true,
});

console.assert(freeState.userCanLaunch === true, "free org active launch");
console.assert(freeState.showPaymentUiOnModuleCard === false, "free hides payment UI despite old invoice");
console.assert(
  buildExternalModuleStatusLabel({
    userCanLaunch: true,
    billingRequired: false,
    orgDecision: { ok: true, reason: "active" },
  }) === "Aktivní – zdarma",
  "free status label"
);

console.log("[external-module-portal.test] OK");
