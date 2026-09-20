import assert from "node:assert/strict";
import {
  attachmentCountForList,
  isLikelySignatureInlineAttachment,
  userVisibleAttachments,
} from "@/lib/email-mailbox/attachment-meta";

assert.equal(
  isLikelySignatureInlineAttachment({
    filename: "logo.png",
    contentType: "image/png",
    size: 12_000,
    disposition: "inline",
    contentId: "logo@x",
    related: true,
  }),
  true
);

assert.equal(
  isLikelySignatureInlineAttachment({
    filename: "faktura.pdf",
    contentType: "application/pdf",
    size: 200_000,
    disposition: "attachment",
  }),
  false
);

const attachments = [
  { id: "1", filename: "a.pdf", contentType: "application/pdf", size: 100, userVisible: true },
  { id: "2", filename: "x.png", contentType: "image/png", size: 10, hidden: true },
];
assert.equal(userVisibleAttachments(attachments).length, 1);
assert.equal(attachmentCountForList(attachments), 1);

console.log("email-mailbox attachment-meta tests: OK");
