import assert from "node:assert/strict";
import { documentEmailSendAllowedForPermissions } from "./document-email-send-access-server";
import {
  resolveEffectivePortalPermissions,
  type PortalModuleId,
  type PortalAccessLevel,
} from "./portal-permissions";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

function matrix(
  partial: Partial<Record<PortalModuleId, PortalAccessLevel>>
): Record<PortalModuleId, PortalAccessLevel> {
  return resolveEffectivePortalPermissions({
    role: "manager",
    employeeDoc: {
      portalModulePermissionsMaterialized: true,
      portalModulePermissions: partial,
    },
  });
}

test("manager jobs write can email contract and attachments", () => {
  const p = matrix({ jobs: "write", documents: "none" });
  assert.equal(documentEmailSendAllowedForPermissions("contract", p), true);
  assert.equal(documentEmailSendAllowedForPermissions("job_attachments", p), true);
  assert.equal(documentEmailSendAllowedForPermissions("material_order", p), true);
  assert.equal(documentEmailSendAllowedForPermissions("advance_invoice", p), true);
});

test("manager jobs read cannot email contract", () => {
  const p = matrix({ jobs: "read", invoices: "read" });
  assert.equal(documentEmailSendAllowedForPermissions("contract", p), false);
  assert.equal(documentEmailSendAllowedForPermissions("handover_protocol", p), false);
});

test("manager invoices read without jobs write can email invoice", () => {
  const p = matrix({ jobs: "read", invoices: "read", documents: "none" });
  assert.equal(documentEmailSendAllowedForPermissions("invoice", p), true);
  assert.equal(documentEmailSendAllowedForPermissions("advance_invoice", p), true);
  assert.equal(documentEmailSendAllowedForPermissions("contract", p), false);
});

test("employee without module access cannot email", () => {
  const p = matrix({ jobs: "none", invoices: "none", documents: "none" });
  assert.equal(documentEmailSendAllowedForPermissions("contract", p), false);
  assert.equal(documentEmailSendAllowedForPermissions("invoice", p), false);
});

test("documents read or jobs write can email issued/received docs", () => {
  const docsOnly = matrix({ jobs: "none", documents: "read" });
  assert.equal(documentEmailSendAllowedForPermissions("issued_document", docsOnly), true);
  const jobsOnly = matrix({ jobs: "write", documents: "none" });
  assert.equal(documentEmailSendAllowedForPermissions("received_document", jobsOnly), true);
});
