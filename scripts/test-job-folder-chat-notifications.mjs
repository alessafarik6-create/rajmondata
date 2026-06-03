import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(
  join(root, "src/lib/email-notifications/job-activity-notify-server.ts"),
  "utf8"
);
const media = readFileSync(join(root, "src/components/jobs/job-media-section.tsx"), "utf8");
const settings = readFileSync(join(root, "src/lib/job-notification-settings.ts"), "utf8");

assert.match(settings, /notifyEmployees/, "notifyEmployees helper");
assert.match(settings, /notifyCustomer/, "notifyCustomer helper");
assert.match(settings, /internalChatEmailNotifications/, "internal chat flag");
assert.match(settings, /customerChatEmailNotifications/, "customer chat flag");

assert.match(server, /isFolderNotifyEmployeesEnabled/, "employee notify gate");
assert.match(server, /isFolderNotifyCustomerEnabled/, "customer notify gate");
assert.match(server, /isJobInternalChatEmailEnabled/, "internal chat gate");
assert.match(server, /isJobCustomerChatEmailEnabled/, "customer chat gate");
assert.match(server, /isFolderMediaNotifyEvent/, "folder media without module blast");
assert.match(server, /else if \(folderMedia\)/, "folder-scoped media branch");
assert.doesNotMatch(
  server,
  /where\("companyId", "==", input\.companyId\)[\s\S]{0,120}where\("role", "==", "customer"\)/,
  "no org-wide customer user scan"
);

assert.match(media, /Posílat notifikace zaměstnancům/, "employee notify UI");
assert.match(media, /Posílat notifikace zákazníkovi/, "customer notify UI");
assert.match(media, /notifyEmployees/, "persist notifyEmployees");

console.log("OK: test-job-folder-chat-notifications");
