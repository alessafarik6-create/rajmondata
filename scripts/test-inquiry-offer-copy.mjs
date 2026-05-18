import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "src/lib/inquiry-offer-copy.ts");
const src = readFileSync(lib, "utf8");

assert.match(src, /INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR/, "error message");
assert.match(src, /splitOfferCopyEmailsInput/, "split helper");
assert.match(src, /mode: "bcc"/, "prefers bcc");

console.log("OK: test-inquiry-offer-copy");
