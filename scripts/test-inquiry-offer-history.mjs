import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "src/lib/inquiry-offer-history.ts");
const history = join(root, "src/components/leads/lead-inquiry-offer-history.tsx");
const detail = join(root, "src/components/leads/lead-inquiry-offer-detail-dialog.tsx");
const sendAdmin = join(root, "src/lib/inquiry-offer-send-admin.ts");

const libSrc = readFileSync(lib, "utf8");
assert.match(libSrc, /inquiryOfferHasFullDetail/, "detail check");
assert.match(libSrc, /INQUIRY_OFFER_LEGACY_DETAIL_MESSAGE/, "legacy message");

const historySrc = readFileSync(history, "utf8");
assert.match(historySrc, /Zobrazit nabídku/, "view button");
assert.match(historySrc, /LeadInquiryOfferDetailDialog/, "detail modal");

const detailSrc = readFileSync(detail, "utf8");
assert.match(detailSrc, /Použít text v nové nabídce/, "reuse");
assert.match(detailSrc, /Znovu odeslat nabídku/, "resend");

const adminSrc = readFileSync(sendAdmin, "utf8");
assert.match(adminSrc, /bodyPlain/, "stores plain body");

console.log("OK: test-inquiry-offer-history");
