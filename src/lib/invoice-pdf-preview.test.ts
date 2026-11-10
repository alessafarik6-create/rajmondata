import assert from "node:assert/strict";
import { buildAdvanceInvoiceHtml, singleLineFromGross } from "@/lib/invoice-a4-html";
import {
  INVOICE_PDF_TEMPLATE_VERSION,
  isInvoicePdfTemplateOutdated,
  legacyInvoiceHtmlMarkers,
  upgradeLegacyInvoiceHtmlCss,
} from "@/lib/invoice-pdf-template";
import { rebuildInvoiceHtmlFromDocument } from "@/lib/invoice-html-rebuild";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";

function mockOneLineAdvanceHtml(): string {
  const row = singleLineFromGross({
    description: "Záloha 50 %",
    amountNet: 413_223,
    vatRate: 21,
    vatAmount: 86_777,
    amountGross: 500_000,
  });
  return buildAdvanceInvoiceHtml({
    title: "Zálohová faktura",
    supplierName: "Dodavatel s.r.o.",
    supplierAddressText: "Ulice 1\nPraha",
    customerName: "Odběratel a.s.",
    customerAddressText: "Ulice 2\nBrno",
    invoiceNumber: "ZF2025-001",
    issueDate: "2025-11-01",
    dueDate: "2025-11-15",
    jobName: "Zakázka test",
    items: [row],
    amountNet: 413_223,
    vatAmount: 86_777,
    amountGross: 500_000,
    bankAccountText: "Banka: Test\nÚčet: 123/0100",
    paymentQrUrl: "https://example.com/qr.png",
  });
}

function testFreshHtmlHasNoLegacyMarkers() {
  const html = mockOneLineAdvanceHtml();
  assert.equal(legacyInvoiceHtmlMarkers(html), false);
  assert.match(html, /payment-section/);
  assert.doesNotMatch(html, /min-height:\s*297mm/i);
}

function testOutdatedStoredDoc() {
  const doc = {
    pdfHtml: "<style>.a4-sheet{min-height:297mm}</style><div class='payment-qr-grid'></div>",
    invoicePdfTemplateVersion: 0,
  };
  assert.equal(isInvoicePdfTemplateOutdated(doc), true);
}

function testCssUpgradeStripsMinHeight() {
  const old =
    '<html><head><style>.a4-sheet{min-height:297mm}</style></head><body><div class="a4-sheet">x</div></body></html>';
  const next = upgradeLegacyInvoiceHtmlCss(old);
  assert.doesNotMatch(next, /min-height:\s*297mm/i);
}

function testRebuildAdvanceFromFirestoreDoc() {
  const rebuilt = rebuildInvoiceHtmlFromDocument({
    invoiceDoc: {
      type: JOB_INVOICE_TYPES.ADVANCE,
      invoiceNumber: "ZF-1",
      issueDate: "2025-11-01",
      dueDate: "2025-11-15",
      jobName: "Zakázka",
      customerName: "Firma",
      customerAddressLines: "Adresa",
      amountNet: 100,
      vatAmount: 21,
      amountGross: 121,
      variableSymbol: "123",
      items: [
        {
          description: "Záloha",
          quantity: 1,
          unit: "ks",
          unitPriceNet: 100,
          vatRate: 21,
          lineNet: 100,
          lineVat: 21,
          lineGross: 121,
        },
      ],
    },
    companyDoc: { companyName: "Dodavatel", companyAddress: "Praha" },
    orgBankAccounts: [],
  });
  assert.equal(rebuilt.ok, true);
  if (rebuilt.ok) {
    assert.equal(rebuilt.templateVersion, INVOICE_PDF_TEMPLATE_VERSION);
    assert.match(rebuilt.html, /payment-section/);
    assert.doesNotMatch(rebuilt.html, /min-height:\s*297mm/i);
  }
}

export async function runInvoicePdfPreviewTests() {
  testFreshHtmlHasNoLegacyMarkers();
  testOutdatedStoredDoc();
  testCssUpgradeStripsMinHeight();
  testRebuildAdvanceFromFirestoreDoc();
  console.log("invoice-pdf-preview.test.ts OK");
}

if (require.main === module) {
  void runInvoicePdfPreviewTests();
}
