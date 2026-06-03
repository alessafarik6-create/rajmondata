import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const resolveLib = readFileSync(join(root, "src/lib/job-customer-chat-resolve.ts"), "utf8");
const apiRoute = readFileSync(
  join(root, "src/app/api/company/jobs/resolve-customer-chat/route.ts"),
  "utf8"
);
const thread = readFileSync(
  join(root, "src/components/jobs/job-customer-chat-thread.tsx"),
  "utf8"
);

for (const field of [
  "customerId",
  "clientId",
  "customerUid",
  "customerPortalUid",
  "portalCustomerId",
  "customerEmail",
  "clientEmail",
  "customerPortalUserIds",
]) {
  assert.match(resolveLib, new RegExp(field), `resolve lib mentions ${field}`);
}

assert.match(resolveLib, /resolveCustomerPortalUidForPreview/, "uses portal preview UID");
assert.match(apiRoute, /findPortalUidByEmail/, "API email lookup");
assert.match(apiRoute, /customerRecordId/, "API CRM user lookup");
assert.match(thread, /resolve-customer-chat/, "thread calls resolve API");
assert.match(thread, /Vytvořit \/ synchronizovat přístup zákazníka/, "portal setup button");
assert.match(thread, /Napište zprávu zákazníkovi/, "message placeholder");
assert.match(thread, /Odeslat zákazníkovi/, "send button label");
assert.match(thread, /customer_conversations/, "shared customer chat storage");

console.log("OK: test-job-customer-chat-resolve");
