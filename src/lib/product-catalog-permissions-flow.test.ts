import assert from "node:assert/strict";
import {
  portalModuleLevelsFromFirestoreRecord,
  portalModulePermissionsRecordFromLevelMap,
  resolveEffectivePortalPermissions,
  sanitizePortalPermissionsForOrgRole,
} from "./portal-permissions";
import { portalPermissionLevelsForAdminEditor } from "./portal-permissions-admin";
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

/** Simuluje PATCH update-org pro productCatalogs write. */
test("save pipeline: productCatalogs write persists in Firestore record", () => {
  const incoming = portalModulePermissionsRecordFromLevelMap(
    sanitizePortalPermissionsForOrgRole(
      portalModuleLevelsFromFirestoreRecord({
        productCatalogs: "write",
        overview: "read",
      }),
      "employee"
    )
  );
  assert.equal(incoming.productCatalogs, "write");

  const row = {
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: incoming,
  };
  const editor = portalPermissionLevelsForAdminEditor(row, "employee");
  assert.equal(editor.productCatalogs, "write");
});

test("UI vs API mismatch: legacy coarse without matrix — API must use employee doc", () => {
  const employeeDoc = {
    employeePortalModules: { zakazky: true, penize: false, zpravy: false, dochazka: false },
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: portalModulePermissionsRecordFromLevelMap(
      sanitizePortalPermissionsForOrgRole(
        { productCatalogs: "write" } as Record<
          import("./portal-permissions").PortalModuleId,
          import("./portal-permissions").PortalAccessLevel
        >,
        "employee"
      )
    ),
  };
  const perms = resolveEffectivePortalPermissions({ role: "employee", employeeDoc });
  assert.equal(perms.productCatalogs, "write");

  const diag = buildCatalogAuthDiagnostic(
    {
      uid: "u1",
      companyId: "c1",
      role: "employee",
      employeeId: "wrong-id",
      globalRoles: [],
    },
    employeeDoc,
    "PATCH",
    "write",
    { resolvedEmployeeId: "emp-real", employeeDocSource: "employees.authUserId" }
  );
  assert.equal(diag.canWrite, true);
  assert.equal(diag.storedProductCatalogs, "write");
});

test("read-only employee cannot write in diagnostic", () => {
  const employeeDoc = {
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: { productCatalogs: "read" },
  };
  const diag = buildCatalogAuthDiagnostic(
    {
      uid: "u2",
      companyId: "c1",
      role: "employee",
      employeeId: "e2",
      globalRoles: [],
    },
    employeeDoc,
    "PATCH",
    "write"
  );
  assert.equal(diag.canWrite, false);
  assert.equal(diag.authorized, false);
});
