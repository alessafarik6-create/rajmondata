/**
 * Notifikace superadmina při registraci organizace (logika, bez Firestore).
 * npx --yes tsx scripts/test-new-organization-notify.mjs
 */
import assert from "node:assert/strict";

import {
  newOrganizationNotificationDocId,
  NEW_ORG_NOTIFICATION_DOC_PREFIX,
  adminOrganizationDetailPath,
} from "../src/lib/platform-admin-notifications/paths.ts";
import { isValidPlatformContactEmail } from "../src/lib/platform-admin-notifications/provider-email.ts";
import { canTriggerNewOrganizationNotify } from "../src/lib/platform-admin-notifications/access.ts";

const orgId = "kovokan-abc12";
assert.equal(newOrganizationNotificationDocId(orgId), `${NEW_ORG_NOTIFICATION_DOC_PREFIX}${orgId}`);
assert.equal(
  newOrganizationNotificationDocId(orgId),
  newOrganizationNotificationDocId(orgId)
);

assert.equal(adminOrganizationDetailPath(orgId), `/admin/companies?orgId=${encodeURIComponent(orgId)}`);

assert.equal(isValidPlatformContactEmail("rajmondata@email.cz"), true);
assert.equal(isValidPlatformContactEmail(""), false);
assert.equal(isValidPlatformContactEmail("bad"), false);

assert.equal(
  canTriggerNewOrganizationNotify({
    role: "owner",
    globalRoles: [],
    callerUid: "u1",
    callerCompanyId: orgId,
    organizationId: orgId,
    organizationOwnerId: "u1",
  }),
  true
);

assert.equal(
  canTriggerNewOrganizationNotify({
    role: "employee",
    globalRoles: [],
    callerUid: "u1",
    callerCompanyId: orgId,
    organizationId: orgId,
    organizationOwnerId: "u1",
  }),
  false
);

assert.equal(
  canTriggerNewOrganizationNotify({
    role: "owner",
    globalRoles: [],
    callerUid: "u1",
    callerCompanyId: "other",
    organizationId: orgId,
    organizationOwnerId: "u1",
  }),
  false
);

console.log("test-new-organization-notify: OK");
