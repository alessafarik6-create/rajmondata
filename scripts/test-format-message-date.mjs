import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/format-message-date.ts"), "utf8");
const dateSafe = readFileSync(join(root, "src/lib/date-safe.ts"), "utf8");
const thread = readFileSync(join(root, "src/components/jobs/job-comments-thread.tsx"), "utf8");
const jobChat = readFileSync(join(root, "src/components/jobs/job-customer-chat-thread.tsx"), "utf8");
const customerChat = readFileSync(join(root, "src/components/customer/customer-chat-panel.tsx"), "utf8");
const customerChatsPage = readFileSync(join(root, "src/app/portal/customer-chats/page.tsx"), "utf8");

assert.match(lib, /MESSAGE_DATE_MISSING_LEGACY/, "legacy missing label");
assert.match(lib, /createdAtMs/, "client ms fallback");
assert.match(lib, /"timestamp"/, "timestamp key");
assert.match(lib, /"sentAt"/, "sentAt key");
assert.match(lib, /buildCustomerChatMessageEnvelope/, "chat envelope helper");
assert.match(lib, /SORT_TIMESTAMP_KEYS/, "sort timestamp keys");
assert.match(thread, /timestamp: serverTimestamp\(\)/, "persist timestamp");
assert.match(thread, /sentAt: serverTimestamp\(\)/, "persist sentAt");
assert.match(thread, /buildMessageTimestampClientFields/, "client fields on send");
assert.match(jobChat, /buildCustomerChatMessageEnvelope/, "job chat envelope");
assert.match(jobChat, /sentAt: serverTimestamp\(\)/, "job chat sentAt");
assert.match(customerChat, /buildCustomerChatMessageEnvelope/, "customer portal envelope");
assert.match(customerChatsPage, /JobMessageHeader/, "customer chats header");
assert.match(customerChatsPage, /compareMessagesByCreatedAt/, "customer chats sort");
assert.match(dateSafe, /isFirestoreServerTimestampPlaceholder/, "server timestamp placeholder");
assert.match(dateSafe, /formatMessageDateFromValue/, "DD.MM.YYYY HH:mm format");

console.log("OK: test-format-message-date");
