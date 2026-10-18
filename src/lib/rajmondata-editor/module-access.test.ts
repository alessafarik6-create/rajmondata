import {
  canOrganizationUseModule,
  canUserUseModuleWithSeats,
  effectiveModulePriceCzk,
} from "@/lib/rajmondata-editor/module-access";
import type { CompanyLicenseDoc } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";

const baseLicense = (mods: CompanyLicenseDoc["modules"]): CompanyLicenseDoc =>
  ({
    companyId: "org1",
    active: true,
    status: "active",
    enabledModules: [],
    modules: mods,
    pricingSnapshot: {},
    employeePricing: {
      perEmployeeCzk: 0,
      moduleCode: "attendance_payroll",
      lastEmployeeCount: 0,
      monthlyModuleCzk: 0,
    },
    activatedAt: null,
    expiresAt: null,
    activatedBy: null,
    notes: "",
  }) as CompanyLicenseDoc;

const catalogRow: PlatformModuleCatalogRow = {
  activeGlobally: true,
  defaultEnabled: false,
  name: "Editor",
  description: "",
  basePriceCzk: 990,
  priceMonthly: 990,
  priceYearly: 9900,
  currency: "CZK",
  billingPeriod: "monthly",
  isPaid: true,
  billingType: "per_company",
  configurableBySuperadmin: true,
  licenseModel: "org_seats",
  defaultSeatCount: 3,
};

console.assert(
  canOrganizationUseModule(
    baseLicense({
      rajmondata_editor: {
        moduleCode: "rajmondata_editor",
        active: true,
        activatedAt: new Date().toISOString(),
        expiresAt: null,
        customPriceCzk: null,
      },
    }),
    "rajmondata_editor"
  ).ok === true,
  "active org module"
);

console.assert(
  canUserUseModuleWithSeats({
    orgDecision: { ok: true, reason: "active" },
    licenseModel: "org_seats",
    assignedUserIds: ["u2"],
    userId: "u1",
    seatCount: 3,
  }).ok === false,
  "unassigned user blocked"
);

console.assert(
  effectiveModulePriceCzk(
    { moduleCode: "rajmondata_editor", active: true, activatedAt: null, expiresAt: null, customPriceCzk: 500 },
    catalogRow,
    "monthly"
  ) === 500,
  "custom price"
);

console.log("[module-access.test] OK");
