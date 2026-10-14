import assert from "node:assert/strict";
import {
  employeeRecordBelongsToCompany,
  employeeRecordCompanyId,
} from "./employee-record-company";
import { parseEmployeePortalRole } from "./employee-portal-role";
import { verifyEmployeeOrgPermissionsSaveResponse } from "./portal-permissions-admin";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("employee without companyId field belongs to parent company path", () => {
  assert.equal(employeeRecordCompanyId({ firstName: "A" }), "");
  assert.equal(employeeRecordBelongsToCompany({ firstName: "A" }, "co-1"), true);
});

test("employee with mismatched companyId is rejected", () => {
  assert.equal(
    employeeRecordBelongsToCompany({ companyId: "other" }, "co-1"),
    false
  );
});

test("parseEmployeePortalRole is case-insensitive", () => {
  assert.equal(parseEmployeePortalRole("Manager"), "manager");
  assert.equal(parseEmployeePortalRole("ORGADMIN"), "orgAdmin");
});

test("verify save response accepts manager role and productCatalogs write", () => {
  const perms: Record<string, string> = { productCatalogs: "write" };
  for (const id of ["overview", "jobs", "customers", "schedule"] as const) {
    perms[id] = "none";
  }
  const err = verifyEmployeeOrgPermissionsSaveResponse({
    requestedRole: "manager",
    requestedPortalModulePermissions: perms,
    responseRole: "manager",
    responsePortalModulePermissions: perms,
  });
  assert.equal(err, null);
});

test("verify save response rejects role mismatch", () => {
  const err = verifyEmployeeOrgPermissionsSaveResponse({
    requestedRole: "manager",
    requestedPortalModulePermissions: { productCatalogs: "write" },
    responseRole: "employee",
    responsePortalModulePermissions: { productCatalogs: "write" },
  });
  assert.ok(err && err.includes("Role"));
});
