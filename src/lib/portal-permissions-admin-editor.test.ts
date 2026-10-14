import assert from "node:assert/strict";
import {
  portalPermissionLevelsForAdminEditor,
  storedPortalPermissionLevelsFromEmployeeDoc,
} from "./portal-permissions-admin";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("materialized productCatalogs write stays in admin editor after load", () => {
  const row = {
    portalModulePermissionsMaterialized: true,
    portalModulePermissions: {
      productCatalogs: "write",
      overview: "read",
      jobs: "none",
    },
  };
  const stored = storedPortalPermissionLevelsFromEmployeeDoc(row);
  assert.equal(stored.productCatalogs, "write");
  const editor = portalPermissionLevelsForAdminEditor(row, "employee");
  assert.equal(editor.productCatalogs, "write");
});

test("non-materialized legacy keeps effective until explicit key stored", () => {
  const row = {
    employeePortalModules: { zakazky: true, penize: false, zpravy: false, dochazka: false },
    portalModulePermissions: { productCatalogs: "write" },
  };
  const editor = portalPermissionLevelsForAdminEditor(row, "employee");
  assert.equal(editor.productCatalogs, "write");
});
