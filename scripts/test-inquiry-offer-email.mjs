import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "src/lib/inquiry-offer-email.ts");
const sendLib = join(root, "src/lib/inquiry-offer-send-admin.ts");
const resend = join(root, "src/lib/email-notifications/resend-send.ts");

const src = readFileSync(lib, "utf8");
assert.match(src, /applyInquiryTemplateVariables/, "template variables helper");
assert.match(src, /buildInquiryOfferEmailHtml/, "branded html builder");
assert.match(src, /resolveInquiryReplyToEmail/, "reply-to resolver");
assert.match(src, /offerReplyEmail/, "offer reply priority");

const sendSrc = readFileSync(sendLib, "utf8");
assert.match(sendSrc, /replyTo/, "send uses replyTo");
assert.match(sendSrc, /nodemailer/, "smtp support");
assert.match(sendSrc, /nabidka_odeslana/, "status after send");

const resendSrc = readFileSync(resend, "utf8");
assert.match(resendSrc, /reply_to/, "resend reply_to");
assert.match(resendSrc, /messageId/, "message id return");

console.log("OK: test-inquiry-offer-email");
