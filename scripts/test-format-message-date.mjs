import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/format-message-date.ts"), "utf8");
const dateSafe = readFileSync(join(root, "src/lib/date-safe.ts"), "utf8");
const thread = readFileSync(join(root, "src/components/jobs/job-comments-thread.tsx"), "utf8");

assert.match(lib, /MESSAGE_DATE_MISSING_LEGACY/, "legacy missing label");
assert.match(lib, /createdAtMs/, "client ms fallback");
assert.match(lib, /"timestamp"/, "timestamp key");
assert.match(lib, /"sentAt"/, "sentAt key");
assert.match(thread, /timestamp: serverTimestamp\(\)/, "persist timestamp");
assert.match(thread, /sentAt: serverTimestamp\(\)/, "persist sentAt");
assert.match(thread, /buildMessageTimestampClientFields/, "client fields on send");
assert.match(dateSafe, /isFirestoreServerTimestampPlaceholder/, "server timestamp placeholder");

console.log("OK: test-format-message-date");
