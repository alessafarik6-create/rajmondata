import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pdfServer = readFileSync(join(root, "src/lib/document-email-pdf-server.ts"), "utf8");
const outbound = readFileSync(join(root, "src/lib/document-email-outbound.ts"), "utf8");
const helpers = readFileSync(join(root, "src/lib/document-email-invoice-helpers.ts"), "utf8");
const sendRoute = readFileSync(
  join(root, "src/app/api/company/document-email/send/route.ts"),
  "utf8"
);
const documentsPage = readFileSync(join(root, "src/app/portal/documents/page.tsx"), "utf8");

assert.doesNotMatch(
  pdfServer,
  /Vybraný doklad není vyúčtovací faktura/,
  "removed final_invoice-only error"
);
assert.doesNotMatch(
  pdfServer,
  /není zálohová faktura/,
  "removed advance-only error for generic invoice type"
);

assert.match(pdfServer, /resolveInvoiceDocumentEmailPdf/, "generic invoice pdf resolver");
assert.match(pdfServer, /resolveCompanyDocumentEmailPdf/, "company document pdf resolver");
assert.match(pdfServer, /rebuildPortalManualInvoiceHtmlAdmin/, "portal manual rebuild");
assert.match(pdfServer, /linkedDocumentId/, "linked document fallback");
assert.match(pdfServer, /storagePath/, "stored pdf fallback");
assert.match(pdfServer, /pdfHtml/, "html pdf generation");

assert.match(outbound, /issued_document/, "issued document email type");
assert.match(outbound, /advance_invoice/, "advance invoice template");

assert.match(helpers, /resolveInvoiceDocumentEmailType/, "invoice type mapping");
assert.match(helpers, /invoiceDocumentEmailSubject/, "subject by doc type");
assert.match(helpers, /companyDocumentEmailSubject/, "company doc subject");

assert.match(sendRoute, /resolveCompanyDocumentEmailPdf/, "send route uses company resolver");
assert.match(sendRoute, /issued_document/, "send route supports issued documents");
assert.match(sendRoute, /received_document/, "send route supports received documents");

assert.match(documentsPage, /resolveInvoiceDocumentEmailType/, "documents UI maps invoice types");
assert.match(documentsPage, /issued_document/, "issued doc email from UI");
assert.match(documentsPage, /openIssuedDocEmailDialog/, "issued doc email button");
assert.match(documentsPage, /DocumentEmailOutboundHistory/, "outbound history");

console.log("OK: test-document-email-send");
