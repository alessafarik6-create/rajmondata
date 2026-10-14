import assert from "node:assert/strict";
import { effectivePortalRoleForCaller } from "./portal-caller-role";
import { resolveEffectivePortalPermissions } from "./portal-permissions";
import { buildCatalogAuthDiagnostic } from "./product-catalogs/catalog-auth-diagnostics";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("company owner UID overrides wrong users.role for catalog write", () => {
  const employeeDoc = {
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: { productCatalogs: "none" },
    role: "employee",
  };
  const caller = {
    uid: "owner-uid",
    companyId: "c1",
    role: "employee",
    employeeId: "emp1",
    globalRoles: [] as string[],
  };
  const role = effectivePortalRoleForCaller(caller, employeeDoc, {
    companyOwnerUid: "owner-uid",
  });
  assert.equal(role, "owner");
  const perms = resolveEffectivePortalPermissions({
    role,
    globalRoles: [],
    employeeDoc,
  });
  assert.equal(perms.productCatalogs, "write");

  const diag = buildCatalogAuthDiagnostic(caller, employeeDoc, "PATCH", "write", {
    companyOwnerUid: "owner-uid",
  });
  assert.equal(diag.canWrite, true);
  assert.equal(diag.authorized, true);
});

test("employee without matrix still denied when not owner", () => {
  const employeeDoc = {
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: { productCatalogs: "read" },
  };
  const caller = {
    uid: "u1",
    companyId: "c1",
    role: "employee",
    employeeId: "e1",
    globalRoles: [] as string[],
  };
  const diag = buildCatalogAuthDiagnostic(caller, employeeDoc, "PATCH", "write", {
    companyOwnerUid: "other-owner",
  });
  assert.equal(diag.canWrite, false);
});
