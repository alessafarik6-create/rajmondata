import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "src/lib/lead-contact-status.ts");
const page = join(root, "src/app/portal/leads/page.tsx");
const sendAdmin = join(root, "src/lib/inquiry-offer-send-admin.ts");

const src = readFileSync(lib, "utf8");
assert.match(src, /resolveLeadContactDisplay/, "contact resolver");
assert.match(src, /offer_sent/, "offer filter");
assert.match(src, /isLeadOfferSent/, "offer sent check");

const pageSrc = readFileSync(page, "utf8");
assert.match(pageSrc, /bg-emerald-50/, "green row styling");
assert.match(pageSrc, /LeadContactRowIndicator/, "contact badge");
assert.match(pageSrc, /filterContact/, "contact filter");

const adminSrc = readFileSync(sendAdmin, "utf8");
assert.match(adminSrc, /markLeadCustomerContacted/, "persist contact on send");

console.log("OK: test-lead-contact-status");
