/**
 * READ vs WRITE — UI helpery, data scope a server kontrola modulů.
 * npx --yes tsx scripts/test-portal-read-write.mjs
 */
import assert from "node:assert/strict";

import {
  canAccessPortalModule,
  portalPermissionsAllowMutation,
  resolveEffectivePortalPermissions,
} from "../src/lib/portal-permissions.ts";
import {
  filterJobsListByDataScope,
  seeAllOrganizationRecordsForModule,
} from "../src/lib/portal-data-scope.ts";

const readDocs = resolveEffectivePortalPermissions({
  role: "accountant",
  employeeDoc: {
    portalModulePermissions: { documents: "read", jobs: "read", leads: "write" },
  },
});

assert.equal(canAccessPortalModule(readDocs, "documents", "read"), true);
assert.equal(portalPermissionsAllowMutation(readDocs, "documents", "accountant"), false);
assert.equal(portalPermissionsAllowMutation(readDocs, "leads", "accountant"), false);
assert.equal(portalPermissionsAllowMutation(readDocs, "jobs", "accountant"), false);

const empReadJobs = resolveEffectivePortalPermissions({
  role: "employee",
  employeeDoc: {
    portalModulePermissions: { jobs: "read", leads: "write", documents: "read" },
  },
});
assert.equal(portalPermissionsAllowMutation(empReadJobs, "jobs", "employee"), false);
assert.equal(canAccessPortalModule(empReadJobs, "jobs", "read"), true);
assert.equal(portalPermissionsAllowMutation(empReadJobs, "leads", "employee"), true);

const owner = resolveEffectivePortalPermissions({ role: "owner" });
assert.equal(portalPermissionsAllowMutation(owner, "documents", "owner"), true);

const offersRead = resolveEffectivePortalPermissions({
  role: "accountant",
  employeeDoc: { portalModulePermissions: { offers: "read" } },
});
assert.equal(portalPermissionsAllowMutation(offersRead, "offers", "accountant"), false);

const laborRead = resolveEffectivePortalPermissions({
  role: "employee",
  employeeDoc: { portalModulePermissions: { labor: "read" } },
});
assert.equal(portalPermissionsAllowMutation(laborRead, "labor", "employee"), false);

// --- Data scope: zakázky ---
assert.equal(
  seeAllOrganizationRecordsForModule("jobs", {
    role: "accountant",
    moduleAccessAtLeastRead: true,
  }),
  true
);

assert.equal(
  seeAllOrganizationRecordsForModule("jobs", {
    role: "employee",
    moduleAccessAtLeastRead: true,
  }),
  false
);

const jobA = { id: "a", assignedEmployeeIds: ["emp-x"] };
const jobB = { id: "b", assignedEmployeeIds: ["emp-y"] };
const all = [jobA, jobB];

const accountantView = filterJobsListByDataScope(all, true, "accountant-uid", undefined);
assert.equal(accountantView.length, 2);

const employeeXView = filterJobsListByDataScope(all, false, "emp-x", "emp-x");
assert.equal(employeeXView.length, 1);
assert.equal(employeeXView[0].id, "a");

console.log("test-portal-read-write: OK");
