import assert from "node:assert/strict";
import {
  aggregateScheduleModuleLevel,
  initialCalendarPermissionsForEmployee,
  normalizeCalendarPermissionsForFirestore,
  resolveCalendarSubLevels,
} from "./calendar/calendar-access";
import { isPortalMenuItemVisible } from "./portal-menu-visibility";
import {
  applyEmployeeOrgRolePermissionCaps,
  canAccessPortalModule,
  EMPLOYEE_PERSONAL_MONEY_MODULE_ID,
  migrateLegacyEmployeeMoneyPermission,
  resolveEffectivePortalPermissions,
  sanitizePortalPermissionsForOrgRole,
} from "./portal-permissions";
import type { PortalModuleId } from "./portal-permissions";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("A: calendar meetings none + installations write persists round-trip", () => {
  const cal = { meetings: "none" as const, installations: "write" as const };
  const stored = normalizeCalendarPermissionsForFirestore(cal);
  assert.deepEqual(stored, { meetings: "none", installations: "write" });
  const row = { calendarPermissions: stored, portalModulePermissions: { schedule: "write" } };
  const subs = resolveCalendarSubLevels({ employeeDoc: row, portalModuleScheduleLevel: "write" });
  assert.equal(subs.meetings, "none");
  assert.equal(subs.installations, "write");
  const ui = initialCalendarPermissionsForEmployee(row, "write");
  assert.equal(ui.meetings, "none");
  assert.equal(ui.installations, "write");
  assert.equal(aggregateScheduleModuleLevel(cal), "write");
});

test("B: employee customers read shows in menu when licensed", () => {
  const employeeRow = {
    portalModulePermissions: {
      customers: "read",
      jobs: "read",
    },
  };
  const ctx = {
    role: "employee",
    globalRoles: undefined,
    company: { license: { status: "active" }, modules: { zakazky: true } },
    effectiveModules: { zakazky: true },
    platformCatalog: {},
    employeeRow,
  };
  const visible = isPortalMenuItemVisible(
    {
      id: "customers",
      type: "child",
      label: "Zákazníci",
      href: "/portal/customers",
      roles: ["owner", "admin", "manager", "accountant", "employee"],
      parentLicenseKeys: ["zakazky"],
      platformModuleCode: "jobs",
    },
    ctx
  );
  assert.equal(visible, true);
});

test("C: employee customers write allows write in effective permissions", () => {
  const perms = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: {
      portalModulePermissions: { customers: "write", overview: "read" },
    },
  });
  assert.equal(canAccessPortalModule(perms, "customers", "write"), true);
});

test("D: employee money read — own money module, not admin labor", () => {
  const perms = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: {
      portalModulePermissions: {
        [EMPLOYEE_PERSONAL_MONEY_MODULE_ID]: "read",
        labor: "none",
        finance: "write",
      },
    },
  });
  assert.equal(canAccessPortalModule(perms, EMPLOYEE_PERSONAL_MONEY_MODULE_ID, "read"), true);
  assert.equal(canAccessPortalModule(perms, "finance", "read"), false);
  assert.equal(canAccessPortalModule(perms, "labor", "write"), false);
});

test("E: employee money none hides module", () => {
  const perms = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: {
      portalModulePermissions: { [EMPLOYEE_PERSONAL_MONEY_MODULE_ID]: "none" },
    },
  });
  assert.equal(canAccessPortalModule(perms, EMPLOYEE_PERSONAL_MONEY_MODULE_ID, "read"), false);
});

test("legacy penize migrates to employeeMoney on resolve", () => {
  const map = migrateLegacyEmployeeMoneyPermission(
    { finance: "read" } as Record<PortalModuleId, "read">,
    { employeePortalModules: { penize: true } }
  );
  assert.equal(map[EMPLOYEE_PERSONAL_MONEY_MODULE_ID], "read");
});

test("sanitize employee role caps money to read and strips finance", () => {
  const out = sanitizePortalPermissionsForOrgRole(
    {
      finance: "write",
      [EMPLOYEE_PERSONAL_MONEY_MODULE_ID]: "write",
      customers: "read",
    } as Record<PortalModuleId, "write" | "read">,
    "employee"
  );
  assert.equal(out.finance, "none");
  assert.equal(out[EMPLOYEE_PERSONAL_MONEY_MODULE_ID], "read");
  assert.equal(out.customers, "read");
});

test("applyEmployeeOrgRolePermissionCaps labor write -> read", () => {
  const out = applyEmployeeOrgRolePermissionCaps({ labor: "write" } as Record<
    PortalModuleId,
    "write"
  >);
  assert.equal(out.labor, "read");
});
