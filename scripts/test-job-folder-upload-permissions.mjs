/**
 * Regrese: nahrávání do složky zakázky podle příznaků složky + archivy.
 * node scripts/test-job-folder-upload-permissions.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const accessSrc = readFileSync(
  join(root, "src/lib/job-employee-access.ts"),
  "utf8"
);
const typesSrc = readFileSync(join(root, "src/lib/job-media-types.ts"), "utf8");
const mediaSrc = readFileSync(
  join(root, "src/components/jobs/job-media-section.tsx"),
  "utf8"
);
const firestoreRules = readFileSync(join(root, "firestore.rules"), "utf8");
const storageRules = readFileSync(join(root, "storage.rules"), "utf8");

assert.doesNotMatch(
  accessSrc,
  /canUploadFiles !== true/,
  "upload must not require global canUploadFiles on job member"
);
assert.match(accessSrc, /isFolderEmployeeVisible/, "folder visibility required");
assert.match(accessSrc, /isFolderEmployeeUploadAllowed/, "folder upload flag required");

assert.match(typesSrc, /"archive"/, "archive file type");
assert.match(typesSrc, /\.zip/, "zip extension allowed");
assert.match(typesSrc, /JOB_MEDIA_ACCEPT_ATTR/, "accept attr includes archives");

assert.match(mediaSrc, /canEmployeeUploadToFolder/, "UI uses folder upload helper");
assert.match(mediaSrc, /JobMediaArchivePreview/, "archive preview icon");
assert.match(mediaSrc, /buildJobMediaCardDateLine/, "card shows size and uploader");
assert.match(mediaSrc, /fileSizeBytes/, "persist file size on upload");

assert.doesNotMatch(
  firestoreRules,
  /jobMemberLimitedPortalCanUploadFiles/,
  "firestore must not gate upload on canUploadFiles"
);
assert.match(
  firestoreRules,
  /folderDocEmployeeUploadAllowed/,
  "firestore checks folder allowEmployeeUpload"
);

assert.doesNotMatch(
  storageRules,
  /storageJobMemberLimitedCanUploadFiles/,
  "storage must not gate upload on canUploadFiles"
);
assert.match(
  storageRules,
  /storageFolderAllowEmployeeUpload/,
  "storage checks folder allowEmployeeUpload"
);

function canEmployeeUploadToFolder(folder, permissions) {
  function isFolderEmployeeVisible(f) {
    return (
      f.employeeVisible === true ||
      f.employeeVisibility === "employee_visible"
    );
  }
  function isFolderEmployeeUploadAllowed(f) {
    return f.allowEmployeeUpload === true || f.employeeUploadAllowed === true;
  }
  if (!isFolderEmployeeVisible(folder)) return false;
  if (!isFolderEmployeeUploadAllowed(folder)) return false;
  const uploads = permissions?.uploadFolderIds;
  if (Array.isArray(uploads) && uploads.length > 0 && !uploads.includes(folder.id)) {
    return false;
  }
  return true;
}

const folderOk = {
  id: "f1",
  employeeVisible: true,
  allowEmployeeUpload: true,
};
const folderHidden = { id: "f2", employeeVisible: false, allowEmployeeUpload: true };
const folderNoUpload = { id: "f3", employeeVisible: true, allowEmployeeUpload: false };

assert.equal(
  canEmployeeUploadToFolder(folderOk, { canUploadFiles: false }),
  true,
  "upload allowed when folder flags on even if member canUploadFiles false"
);
assert.equal(canEmployeeUploadToFolder(folderHidden, {}), false);
assert.equal(canEmployeeUploadToFolder(folderNoUpload, {}), false);
assert.equal(
  canEmployeeUploadToFolder(folderOk, { uploadFolderIds: ["other"] }),
  false,
  "whitelist respected"
);

console.log("OK: job folder upload permissions and archive support.");
