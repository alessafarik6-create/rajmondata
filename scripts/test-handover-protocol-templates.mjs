import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fields = readFileSync(join(root, "src/lib/handover-protocol-template-fields.ts"), "utf8");
assert.match(fields, /handoverTemplateContentFromForm/, "extract template fields");
assert.match(fields, /applyHandoverTemplateToForm/, "apply template");
assert.doesNotMatch(fields, /customerName|handoverDateLabel/, "no job-specific fields in template lib");

const rules = readFileSync(join(root, "firestore.rules"), "utf8");
assert.match(rules, /handoverProtocolTemplates/, "firestore rules for templates");

const pdfHtml = readFileSync(join(root, "src/lib/handover-protocol-pdf-html.ts"), "utf8");
assert.match(pdfHtml, /logoUrl/, "logo in PDF");
assert.doesNotMatch(pdfHtml, /DPH|záloh|QR|amountGross|priceFormatted/i, "no financial fields in PDF");

const formDlg = readFileSync(
  join(root, "src/components/handover-protocols/handover-protocol-form-dialog.tsx"),
  "utf8"
);
assert.match(formDlg, /Uložit jako šablonu/, "save template button");
assert.match(formDlg, /Vybrat šablonu/, "select template");
assert.match(formDlg, /Vygenerovat PDF/, "pdf button in form");
assert.match(formDlg, /Tisk/, "print in form");

const section = readFileSync(
  join(root, "src/components/handover-protocols/job-handover-protocols-section.tsx"),
  "utf8"
);
assert.match(section, /Otevřít/, "open button");
assert.match(section, /Odeslat e-mailem/, "email button");
assert.match(section, /printProtocol/, "print handler");

console.log("OK: test-handover-protocol-templates");
