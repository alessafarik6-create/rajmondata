/**
 * Logika záloh organizace (oprávnění, retention, checksum).
 * npx --yes tsx scripts/test-organization-backup-logic.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  callerCanCreateOrganizationBackup,
  callerCanReadOrganizationBackups,
  callerCanRestoreOrganizationBackup,
  buildRestoreConfirmationPhrase,
} from "../src/lib/organization-backup/permissions.ts";
import {
  BACKUP_RETENTION_DAYS,
  ORGANIZATION_BACKUP_SCHEMA_VERSION,
} from "../src/lib/organization-backup/constants.ts";
import {
  computeBackupExpiresAt,
  cronBackupTypeForDate,
} from "../src/lib/organization-backup/retention.ts";
import { verifyManifestChecksum } from "../src/lib/organization-backup/export-service.ts";

assert.equal(callerCanReadOrganizationBackups("admin", []), true);
assert.equal(callerCanReadOrganizationBackups("accountant", []), false);
assert.equal(callerCanCreateOrganizationBackup("owner", []), true);
assert.equal(callerCanRestoreOrganizationBackup("admin", []), false);
assert.equal(callerCanRestoreOrganizationBackup("owner", []), true);

assert.equal(buildRestoreConfirmationPhrase("Kovokan"), "OBNOVIT KOVOKAN");

const dailyExp = computeBackupExpiresAt("DAILY", new Date("2026-01-01T00:00:00Z"));
assert.equal(dailyExp.toISOString().slice(0, 10), "2026-01-31");
assert.equal(BACKUP_RETENTION_DAYS.WEEKLY, 84);

const sunday = cronBackupTypeForDate(new Date("2026-09-06T12:00:00Z"));
assert.ok(sunday.includes("DAILY"));
assert.ok(sunday.includes("WEEKLY"));

const manifestBase = {
  schemaVersion: ORGANIZATION_BACKUP_SCHEMA_VERSION,
  backupId: "b1",
  organizationId: "org1",
  organizationName: "Test",
  backupType: "MANUAL",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "u1",
  recordCounts: { total: 10, byTopCollection: { jobs: 10 } },
  fileCount: 2,
  sizeBytes: 100,
  firestoreNdjsonPath: "x/firestore/export.ndjson",
  filesManifestPath: "x/files/",
};
const checksum = createHash("sha256").update(JSON.stringify(manifestBase)).digest("hex");
const manifest = { ...manifestBase, checksum };
assert.equal(verifyManifestChecksum(manifest), true);
assert.equal(verifyManifestChecksum({ ...manifest, recordCounts: { total: 9, byTopCollection: {} } }), false);

console.log("test-organization-backup-logic: OK");
