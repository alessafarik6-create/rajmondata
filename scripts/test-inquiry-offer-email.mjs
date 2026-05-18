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

const planLib = join(root, "src/lib/inquiry-offer-send-plan.ts");
const resendLib = join(root, "src/lib/inquiry-offer-resend.ts");

const sendSrc = readFileSync(sendLib, "utf8");
assert.match(sendSrc, /replyTo/, "send uses replyTo");
assert.match(sendSrc, /nodemailer/, "smtp support");
assert.match(sendSrc, /nabidka_odeslana/, "status after send");
assert.match(sendSrc, /buildInquiryOfferSendPlan/, "send plan builder");
assert.match(sendSrc, /buildInquiryOfferDeliveryHeaders/, "Reply-To header builder");
assert.match(sendSrc, /buildInquiryOfferHistoryFields/, "history fields");
assert.match(sendSrc, /platform_fallback/, "platform fallback path");

const planSrc = readFileSync(planLib, "utf8");
assert.match(planSrc, /platform_fallback/, "fallback method in plan");
assert.match(planSrc, /formatInquiryOfferFromHeader/, "from header formatter");

const resendHelper = readFileSync(resendLib, "utf8");
assert.match(resendHelper, /isResendDomainNotVerifiedError/, "domain error detection");
assert.match(resendHelper, /resolvePlatformFallbackSenderEmail/, "platform fallback email");

const resendSrc = readFileSync(resend, "utf8");
assert.match(resendSrc, /replyTo/, "resend replyTo (SDK v6)");
assert.match(planSrc, /Reply-To/, "explicit Reply-To delivery header");
assert.match(resendSrc, /messageId/, "message id return");
assert.match(resendSrc, /attachments/, "resend attachments support");

const pricingLib = join(root, "src/lib/inquiry-offer-pricing.ts");
const attachResolve = join(root, "src/lib/inquiry-offer-attachment-resolve.ts");
const pricingSrc = readFileSync(pricingLib, "utf8");
const attachSrc = readFileSync(attachResolve, "utf8");

assert.match(pricingSrc, /buildInquiryOfferSentBodyPlain/, "sent body with pricing");
assert.match(pricingSrc, /parseInquiryPriceInput/, "price input parser");
assert.match(sendSrc, /buildInquiryOfferSentBodyPlain/, "send uses pricing body");
assert.match(sendSrc, /attachments: params.attachments/, "resend passes attachments");
assert.match(attachSrc, /INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR/, "attachment load error");

const copyLib = join(root, "src/lib/inquiry-offer-copy.ts");
const copySrc = readFileSync(copyLib, "utf8");
assert.match(copySrc, /validateOfferCopyEmailsRaw/, "copy email validation");
assert.match(copySrc, /resolveInquiryOfferCopyDelivery/, "copy delivery resolver");
assert.match(sendSrc, /offerCopyTo/, "history stores copy recipients");
assert.match(sendSrc, /offerCopyMode/, "history stores copy mode");
assert.match(sendSrc, /deliverViaResend/, "resend delivery");
assert.match(resendSrc, /bcc/, "resend bcc support");

console.log("OK: test-inquiry-offer-email");
