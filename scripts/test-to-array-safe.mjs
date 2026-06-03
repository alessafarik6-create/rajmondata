import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Inline mirror of toArraySafe for script (no TS import)
function toArraySafe(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

assert.deepEqual(toArraySafe(null), []);
assert.deepEqual(toArraySafe(undefined), []);
assert.deepEqual(toArraySafe([1, 2]), [1, 2]);
assert.deepEqual(toArraySafe({ a: 1, b: 2 }).sort(), [1, 2]);
assert.deepEqual(toArraySafe("x"), []);

const jobDetail = readFileSync(
  join(root, "src/app/portal/jobs/job-detail-page-content.tsx"),
  "utf8"
);
assert.match(jobDetail, /toArraySafe/, "job detail uses toArraySafe");
assert.doesNotMatch(
  jobDetail,
  /for \(const row of companyUsersForNotifyRaw as/,
  "no raw for-of on notify users"
);

const recipients = readFileSync(
  join(root, "src/lib/job-notification-recipients.ts"),
  "utf8"
);
assert.match(recipients, /toArraySafe/, "recipients parser uses toArraySafe");

console.log("OK: test-to-array-safe");
