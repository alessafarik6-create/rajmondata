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
const recipients = readFileSync(
  join(root, "src/lib/job-notification-recipients.ts"),
  "utf8"
);
const panel = readFileSync(
  join(root, "src/components/jobs/job-email-notification-recipients-panel.tsx"),
  "utf8"
);
const chatBlock = readFileSync(
  join(root, "src/components/jobs/job-chat-email-notifications-block.tsx"),
  "utf8"
);

assert.match(recipients, /parseFolderEmailNotificationSettings/, "folder settings parser");
assert.match(recipients, /parseJobInternalChatNotificationSettings/, "internal chat parser");
assert.match(recipients, /parseJobCustomerChatNotificationSettings/, "customer chat parser");
assert.match(recipients, /resolveRecipientsFromConfiguredList/, "configured recipient resolver");
assert.match(recipients, /Notifikace půjdou na:/, "recipient summary text");

assert.match(server, /parseFolderEmailNotificationSettings/, "folder notify from list");
assert.match(server, /parseJobInternalChatNotificationSettings/, "internal chat from list");
assert.match(server, /parseJobCustomerChatNotificationSettings/, "customer chat from list");
assert.match(server, /resolveRecipientsFromConfiguredList/, "server uses configured list");
assert.match(server, /filterChatRecipients/, "customer chat role filter");
assert.match(server, /isFolderMediaNotifyEvent/, "folder media without module blast");
assert.doesNotMatch(
  server,
  /addModuleRecipients/,
  "no global module recipient blast"
);

assert.match(media, /emailNotificationsEnabled/, "persist folder email flag");
assert.match(media, /notificationRecipients/, "persist folder recipients");
assert.match(panel, /E-mailové notifikace/, "folder notification section title");
assert.match(panel, /Posílat notifikace/, "send notifications toggle");
assert.match(panel, /Přidat vlastní e-mail/, "custom email input");

assert.match(chatBlock, /internalChatEmailNotificationsEnabled/, "internal chat flag");
assert.match(chatBlock, /customerChatEmailNotificationsEnabled/, "customer chat flag");
assert.match(chatBlock, /JobEmailNotificationRecipientsPanel/, "chat uses recipient panel");

console.log("OK: test-job-folder-chat-notifications");
