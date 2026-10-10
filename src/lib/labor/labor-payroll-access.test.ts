import assert from "node:assert/strict";
import {
  assertPayrollMutationAllowed,
  assertPayrollTargetEmployee,
  canManageOrganizationPayroll,
  canViewOthersPayrollData,
  isSelfPayrollOnlyUser,
  type PayrollAccessContext,
} from "./labor-payroll-access";
import { resolveEffectivePortalPermissions } from "@/lib/portal-permissions";

function ctx(
  role: string,
  labor: "none" | "read" | "write",
  employeeId: string | null = "emp-a"
): PayrollAccessContext {
  const permissions = resolveEffectivePortalPermissions({
    role,
    employeeDoc: {
      portalModulePermissions: { labor },
    },
  });
  return { role, employeeId, permissions };
}

function testEmployeeSelfOnlyAndNoMutations() {
  const employee = ctx("employee", "write", "emp-a");
  assert.equal(isSelfPayrollOnlyUser(employee), true);
  assert.equal(canViewOthersPayrollData(employee), false);
  assert.equal(canManageOrganizationPayroll(employee), false);
  const mut = assertPayrollMutationAllowed(employee);
  assert.equal(mut.ok, false);
  if (!mut.ok) assert.equal(mut.status, 403);
  assert.equal(
    assertPayrollTargetEmployee({ ctx: employee, targetEmployeeId: "emp-a" }).ok,
    true
  );
  assert.equal(
    assertPayrollTargetEmployee({ ctx: employee, targetEmployeeId: "emp-b" }).ok,
    false
  );
}

function testAccountantReadWriteOthers() {
  const accRead = ctx("accountant", "read", null);
  assert.equal(canViewOthersPayrollData(accRead), true);
  assert.equal(canManageOrganizationPayroll(accRead), false);
  assert.equal(assertPayrollMutationAllowed(accRead).ok, false);

  const accWrite = ctx("accountant", "write", null);
  assert.equal(canManageOrganizationPayroll(accWrite), true);
  assert.equal(assertPayrollMutationAllowed(accWrite).ok, true);
}

function testManagerDefaultSelfOnly() {
  const manager = ctx("manager", "write", "mgr-1");
  assert.equal(canViewOthersPayrollData(manager), false);
  assert.equal(isSelfPayrollOnlyUser(manager), true);
  assert.equal(canManageOrganizationPayroll(manager), false);
  assert.equal(
    assertPayrollTargetEmployee({ ctx: manager, targetEmployeeId: "other" }).ok,
    false
  );
}

function testOwnerWithLaborWrite() {
  const owner = ctx("owner", "write", null);
  assert.equal(canViewOthersPayrollData(owner), true);
  assert.equal(canManageOrganizationPayroll(owner), true);
  assert.equal(isSelfPayrollOnlyUser(owner), false);
}

function testEmployeeLaborWriteStillNoPayrollMutations() {
  const employeeWriteMatrix = ctx("employee", "write", "emp-x");
  assert.equal(canManageOrganizationPayroll(employeeWriteMatrix), false);
  assert.equal(assertPayrollMutationAllowed(employeeWriteMatrix).ok, false);
}

function testPayrollTargetEmployeeIsolation() {
  const employee = ctx("employee", "read", "emp-a");
  assert.equal(
    assertPayrollTargetEmployee({ ctx: employee, targetEmployeeId: "emp-b" }).ok,
    false
  );
}

function run() {
  testEmployeeSelfOnlyAndNoMutations();
  testAccountantReadWriteOthers();
  testManagerDefaultSelfOnly();
  testOwnerWithLaborWrite();
  testEmployeeLaborWriteStillNoPayrollMutations();
  testPayrollTargetEmployeeIsolation();
  console.log("labor-payroll-access.test.ts: OK");
}

run();
