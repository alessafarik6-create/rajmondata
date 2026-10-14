import assert from "node:assert/strict";
import {
  canAccessPortalModule,
  canWriteModule,
  resolveEffectivePortalPermissions,
} from "./portal-permissions";
import { effectivePortalRoleForCaller } from "./portal-caller-role";
import { buildEmployeePortalAccessSnapshot } from "./portal-permissions-admin";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("employee with productCatalogs write gets effective write in portal resolver", () => {
  const perms = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: {
      portalModulePermissionsMaterialized: true,
      portalModulePermissions: {
        productCatalogs: "write",
        overview: "read",
        settings: "write",
      },
    },
  });
  assert.equal(perms.productCatalogs, "write");
  assert.equal(perms.settings, "none");
  assert.equal(canAccessPortalModule(perms, "productCatalogs", "write"), true);
  assert.equal(canWriteModule(perms, "productCatalogs", "employee"), true);
});

test("employee productCatalogs read cannot write", () => {
  const perms = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: {
      portalModulePermissionsMaterialized: true,
      portalModulePermissions: { productCatalogs: "read" },
    },
  });
  assert.equal(canAccessPortalModule(perms, "productCatalogs", "read"), true);
  assert.equal(canAccessPortalModule(perms, "productCatalogs", "write"), false);
});

test("effectivePortalRole uses employee doc manager when users.role is employee", () => {
  const role = effectivePortalRoleForCaller(
    {
      uid: "u1",
      companyId: "c1",
      role: "employee",
      employeeId: "e1",
      globalRoles: [],
    },
    { role: "manager", portalModulePermissions: { productCatalogs: "write" } }
  );
  assert.equal(role, "manager");
  const perms = resolveEffectivePortalPermissions({
    role,
    employeeDoc: { role: "manager", portalModulePermissions: { productCatalogs: "write" } },
  });
  assert.equal(canAccessPortalModule(perms, "productCatalogs", "write"), true);
});

test("access snapshot shows mismatch when org role caps write", () => {
  const snap = buildEmployeePortalAccessSnapshot(
    {
      portalModulePermissionsMaterialized: true,
      portalModulePermissions: { finance: "write", productCatalogs: "write" },
    },
    "employee"
  );
  const finance = snap.moduleRows.find((r) => r.moduleId === "finance");
  const catalogs = snap.moduleRows.find((r) => r.moduleId === "productCatalogs");
  assert.equal(finance?.effectiveLevel, "none");
  assert.ok(
    finance?.limitReason === "org_role_cap" || finance?.limitReason === "legacy_preset"
  );
  assert.equal(catalogs?.effectiveLevel, "write");
});

test("snapshot uses saved DB role for effective not unsaved editor role", () => {
  const snap = buildEmployeePortalAccessSnapshot(
    {
      role: "employee",
      portalModulePermissionsMaterialized: true,
      portalModulePermissions: { productCatalogs: "none" },
      employeePortalModules: { zakazky: true, penize: false, zpravy: false, dochazka: false },
    },
    "manager"
  );
  assert.equal(snap.savedOrgRole, "employee");
  assert.equal(snap.editorOrgRole, "manager");
  assert.equal(snap.rolesDiffer, true);
  const catalogs = snap.moduleRows.find((r) => r.moduleId === "productCatalogs");
  assert.ok(catalogs);
  assert.equal(catalogs!.editorLevel, "none");
  assert.equal(catalogs!.effectiveLevel, "none");
});
