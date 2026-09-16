/**
 * Testy oprávnění portálu (NONE / READ / WRITE).
 * npx --yes tsx scripts/test-portal-permissions.mjs
 */
import assert from "node:assert/strict";

import {
  buildAccountantPermissionPreset,
  buildLegacyEmployeePermissionPreset,
  canAccessPortalModule,
  portalAccessLevelSatisfies,
  portalPermissionsAllowMutation,
  resolveEffectivePortalPermissions,
  applyPermissionPreset,
} from "../src/lib/portal-permissions.ts";

assert.equal(portalAccessLevelSatisfies("write", "read"), true);
assert.equal(portalAccessLevelSatisfies("read", "write"), false);
assert.equal(portalAccessLevelSatisfies("none", "read"), false);

const accountant = resolveEffectivePortalPermissions({ role: "accountant" });
assert.equal(canAccessPortalModule(accountant, "invoices", "read"), true);
assert.equal(portalPermissionsAllowMutation(accountant, "invoices", "accountant"), false);

const owner = resolveEffectivePortalPermissions({ role: "owner" });
assert.equal(canAccessPortalModule(owner, "finance", "write"), true);
assert.equal(portalPermissionsAllowMutation(owner, "finance", "owner"), true);

const empBase = resolveEffectivePortalPermissions({
  role: "employee",
  employeeDoc: {
    employeePortalModules: { zakazky: true, penize: false, zpravy: true, dochazka: true },
    canAccessMeetingNotes: true,
  },
});
assert.equal(canAccessPortalModule(empBase, "leads", "write"), true);
assert.equal(canAccessPortalModule(empBase, "finance", "read"), false);

const empOverride = resolveEffectivePortalPermissions({
  role: "employee",
  employeeDoc: {
    portalModulePermissions: { leads: "write", jobs: "read", finance: "none" },
    employeePortalModules: { zakazky: true, penize: true, zpravy: true, dochazka: true },
  },
});
assert.equal(canAccessPortalModule(empOverride, "leads", "write"), true);
assert.equal(canAccessPortalModule(empOverride, "jobs", "write"), false);
assert.equal(canAccessPortalModule(empOverride, "jobs", "read"), true);
assert.equal(canAccessPortalModule(empOverride, "finance", "read"), false);

const preset = buildAccountantPermissionPreset();
assert.equal(preset.employees, "read");
assert.equal(preset.jobs, "read");
assert.equal(preset.billing, "none");

const readAll = applyPermissionPreset("read_all");
assert.equal(readAll.sklad, "read");
assert.equal(portalPermissionsAllowMutation(readAll, "sklad", "employee"), false);

console.log("test-portal-permissions: OK");
