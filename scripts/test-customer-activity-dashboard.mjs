import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lib = readFileSync(join(root, "src/lib/customer-activity.ts"), "utf8");
assert.match(lib, /resolveCustomerActivityAtMs/, "timestamp resolver");
assert.match(lib, /createdAt[\s\S]*timestamp[\s\S]*sentAt[\s\S]*updatedAt/, "fallback chain");
assert.match(lib, /formatCustomerActivityDateTime/, "datetime format");
assert.match(lib, /72 \* 60 \* 60 \* 1000/, "72h boundary");
assert.match(lib, /sortCustomerActivitiesByNewest/, "sort helper");

const section = readFileSync(
  join(root, "src/components/portal/dashboard-activity-section.tsx"),
  "utf8"
);
assert.match(section, /highlightCustomerAge/, "customer age highlight prop");
assert.match(section, /border-l-green-500/, "green fresh style");
assert.match(section, /border-l-red-500/, "red stale style");
assert.match(section, /formatCustomerActivityDateTime/, "uses customer datetime");
assert.match(section, /Vyřízeno/, "resolved button");
assert.match(section, /Otevřít/, "open button");

const dashboard = readFileSync(join(root, "src/app/portal/dashboard/page.tsx"), "utf8");
assert.match(dashboard, /highlightCustomerAge/, "dashboard enables highlight");
assert.match(dashboard, /sortCustomerActivitiesByNewest/, "dashboard sorts");

console.log("OK: test-customer-activity-dashboard");
