/**
 * Vystavení faktury provozovatele platformy (sdíleno POST superadmin + cron automatika).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import {
  allocatePlatformInvoiceSequence,
  buildLineRowsFromInput,
  buildPlatformFeeInvoiceHtml,
  companyDocToBillingCustomer,
  formatPlatformInvoiceNumber,
  loadBillingProviderOrThrow,
  loadCompanyDocOrThrow,
  snapshotCustomerFromCompany,
  snapshotSupplierFromProvider,
  sumInvoiceLines,
  type PlatformInvoiceLineInput,
  variableSymbolFromInvoiceNumber,
} from "@/lib/platform-billing";
import { platformInvoiceExistsForPeriod } from "@/lib/platform-invoice-auto";

export type IssuePlatformInvoiceSource = "manual" | "license_auto" | "automation";

export type IssuePlatformInvoiceParams = {
  db: Firestore;
  bucket: Bucket;
  organizationId: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  issueDate?: string;
  note?: string | null;
  items: PlatformInvoiceLineInput[];
  createdBy: string;
  issueSource?: IssuePlatformInvoiceSource;
  skipDuplicateCheck?: boolean;
};

export type IssuePlatformInvoiceResult = {
  invoiceId: string;
  invoiceNumber: string;
  pdfUrl: string;
  storagePath: string;
  amountGross: number;
  variableSymbol: string;
};

export async function issuePlatformInvoiceAdmin(
  params: IssuePlatformInvoiceParams
): Promise<IssuePlatformInvoiceResult> {
  const {
    db,
    bucket,
    organizationId,
    periodFrom,
    periodTo,
    dueDate,
    issueDate,
    note,
    items,
    createdBy,
    issueSource = "manual",
    skipDuplicateCheck,
  } = params;

  if (!skipDuplicateCheck) {
    const dup = await platformInvoiceExistsForPeriod(db, organizationId, periodFrom, periodTo);
    if (dup) {
      throw new Error(
        `Za období ${periodFrom} – ${periodTo} již existuje faktura (nelze duplikovat).`
      );
    }
  }

  const provider = await loadBillingProviderOrThrow(db);
  const company = await loadCompanyDocOrThrow(db, organizationId);
  const seq = await allocatePlatformInvoiceSequence(db);
  const issue = issueDate?.trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const year = Number(issue.slice(0, 4)) || new Date().getFullYear();
  const invoiceNumber = formatPlatformInvoiceNumber(seq, year);
  const variableSymbol = variableSymbolFromInvoiceNumber(invoiceNumber);
  const lineRows = buildLineRowsFromInput(items);
  const { amountNet, vatAmount, amountGross } = sumInvoiceLines(lineRows);
  const rates = [...new Set(lineRows.map((r) => r.vatRate))];
  const primaryVatLabel = rates.length === 1 ? `${rates[0]} %` : "více sazeb DPH";
  const customer = companyDocToBillingCustomer(company);
  const orgName = String(company.companyName || company.name || organizationId).trim();
  const html = buildPlatformFeeInvoiceHtml({
    billingProvider: provider,
    customer,
    invoiceNumber,
    issueDate: issue,
    dueDate,
    taxSupplyDate: issue,
    periodFrom,
    periodTo,
    items: lineRows,
    amountNet,
    vatAmount,
    amountGross,
    primaryVatLabel,
    note: note?.trim() || null,
    variableSymbol,
  });
  const pdfBuf = await renderStoredHtmlToPdfBuffer(html);
  const invRef = db.collection(PLATFORM_INVOICES_COLLECTION).doc();
  const invoiceId = invRef.id;
  const storagePath = `platform_invoices/${organizationId}/${invoiceId}.pdf`;
  const f = bucket.file(storagePath);
  await f.save(pdfBuf, {
    metadata: { contentType: "application/pdf", cacheControl: "private, max-age=120" },
  });
  try {
    await f.makePublic();
  } catch (e) {
    console.warn("[issuePlatformInvoiceAdmin] makePublic:", e);
  }
  const encoded = encodeURIComponent(storagePath);
  const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
  const supplierSnapshot = snapshotSupplierFromProvider(provider);
  const customerSnapshot = snapshotCustomerFromCompany(organizationId, company);
  await invRef.set({
    id: invoiceId,
    organizationId,
    organizationName: orgName,
    invoiceNumber,
    variableSymbol,
    issueDate: issue,
    dueDate,
    periodFrom,
    periodTo,
    supplier: supplierSnapshot,
    customer: customerSnapshot,
    items: lineRows.map((r, i) => ({
      index: i,
      description: r.description,
      quantity: r.quantity,
      unit: r.unit,
      unitPriceNet: r.unitPriceNet,
      vatRate: r.vatRate,
      lineNet: r.lineNet,
      lineVat: r.lineVat,
      lineGross: r.lineGross,
    })),
    subtotal: amountNet,
    vatAmount,
    total: amountGross,
    currency: "CZK",
    status: "unpaid",
    pdfUrl,
    storagePath,
    note: note?.trim() || null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
    paidAt: null,
    issueSource,
    issuedByAutomation: issueSource === "automation",
  });
  return {
    invoiceId,
    invoiceNumber,
    pdfUrl,
    storagePath,
    amountGross,
    variableSymbol,
  };
}
