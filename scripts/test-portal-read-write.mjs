/**
 * READ vs WRITE — UI helpery a server kontrola modulů.
 * npx --yes tsx scripts/test-portal-read-write.mjs
 */
import assert from "node:assert/strict";

import {
  canAccessPortalModule,
  portalPermissionsAllowMutation,
  resolveEffectivePortalPermissions,
} from "../src/lib/portal-permissions.ts";

const readDocs = resolveEffectivePortalPermissions({
  role: "accountant",
  employeeDoc: {
    portalModulePermissions: { documents: "read", jobs: "read", leads: "write" },
  },
});

assert.equal(canAccessPortalModule(readDocs, "documents", "read"), true);
assert.equal(portalPermissionsAllowMutation(readDocs, "documents", "accountant"), false);
assert.equal(portalPermissionsAllowMutation(readDocs, "leads", "accountant"), false);

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

console.log("test-portal-read-write: OK");
