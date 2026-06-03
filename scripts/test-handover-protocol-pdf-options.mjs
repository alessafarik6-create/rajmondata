import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfHtml = readFileSync(join(root, "src/lib/handover-protocol-pdf-html.ts"), "utf8");
const types = readFileSync(join(root, "src/lib/handover-protocol-types.ts"), "utf8");
const formDlg = readFileSync(
  join(root, "src/components/handover-protocols/handover-protocol-form-dialog.tsx"),
  "utf8"
);

assert.doesNotMatch(pdfHtml, /buildOrganizationElectronicStampBlock/, "no huge org stamp outside box");
assert.match(pdfHtml, /useElectronicSignatures/, "electronic signatures toggle in PDF");
assert.match(pdfHtml, /showDefects/, "defects toggle in PDF");
assert.match(pdfHtml, /Podpis zatím chybí/, "missing signature message");
assert.match(pdfHtml, /grid-template-columns:\s*1fr 1fr/, "equal signature columns");
assert.match(pdfHtml, /sig-area/, "signature contained in area");
assert.match(pdfHtml, /blank-line/, "blank lines for manual fill");

assert.match(types, /useElectronicSignatures/, "form type has electronic option");
assert.match(types, /showDefects/, "form type has defects option");

assert.doesNotMatch(formDlg, /const validate =/, "no required validation");
assert.doesNotMatch(formDlg, /Label>.*\*/, "no asterisk labels");
assert.match(formDlg, /Použít elektronické podpisy/, "UI toggle electronic");
assert.match(formDlg, /Zobrazit vady a nedodělky/, "UI toggle defects");

console.log("OK: test-handover-protocol-pdf-options");
