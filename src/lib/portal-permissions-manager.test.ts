import assert from "node:assert/strict";
import {
  applyManagerPermissionCaps,
  buildManagerPermissionPreset,
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
  sanitizePortalPermissionsForOrgRole,
} from "./portal-permissions";
import { parseEmployeePortalRole, userRoleForEmployeePortalRole } from "./employee-portal-role";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("manager portal role maps to users.role manager", () => {
  assert.equal(parseEmployeePortalRole("manager"), "manager");
  assert.equal(userRoleForEmployeePortalRole("manager"), "manager");
});

test("manager preset forbids settings and billing", () => {
  const p = buildManagerPermissionPreset();
  assert.equal(p.settings, "none");
  assert.equal(p.billing, "none");
  assert.equal(canAccessPortalModule(p, "customers", "write"), true);
});

test("manager caps strip forbidden modules on set-all write", () => {
  const capped = applyManagerPermissionCaps(
    Object.fromEntries(
      ["settings", "billing", "customers"].map((id) => [id, "write"])
    ) as Record<string, "write">
  );
  assert.equal(capped.settings, "none");
  assert.equal(capped.billing, "none");
  assert.equal(capped.customers, "write");
});

test("resolveEffectivePortalPermissions manager uses explicit matrix", () => {
  const p = resolveEffectivePortalPermissions({
    role: "manager",
    employeeDoc: {
      portalModulePermissions: {
        overview: "read",
        customers: "write",
        settings: "write",
        finance: "none",
      },
    },
  });
  assert.equal(p.overview, "read");
  assert.equal(p.customers, "write");
  assert.equal(p.settings, "none");
  assert.equal(p.finance, "none");
  assert.equal(canAccessPortalModule(p, "finance", "read"), false);
});

test("resolveEffectivePortalPermissions manager default preset", () => {
  const p = resolveEffectivePortalPermissions({
    role: "manager",
    employeeDoc: {},
  });
  assert.equal(p.settings, "none");
  assert.equal(canAccessPortalModule(p, "jobs", "write"), true);
});

test("sanitizePortalPermissionsForOrgRole only affects manager", () => {
  const levels = sanitizePortalPermissionsForOrgRole(
    { settings: "write", customers: "write" } as Record<
      import("./portal-permissions").PortalModuleId,
      import("./portal-permissions").PortalAccessLevel
    >,
    "employee"
  );
  assert.equal(levels.settings, "write");
  const mgr = sanitizePortalPermissionsForOrgRole(levels, "manager");
  assert.equal(mgr.settings, "none");
});
