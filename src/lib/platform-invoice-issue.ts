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
import {
  buildInvoicePaymentQr,
  convertToIban,
  parsePaymentAccountString,
} from "@/lib/invoice-billing-meta";

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
  /** Biz logika zdroje (např. aktivace modulu). */
  platformInvoiceSource?: "moduleActivation";
  moduleId?: string;
  moduleName?: string | null;
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
    platformInvoiceSource,
    moduleId,
    moduleName,
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

  let baseLicensePrice = 0;
  let modulesTotal = 0;
  let employeeCount = 0;
  let employeeTotal = 0;
  let employeePrice = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = lineRows[i];
    if (!it || !row) continue;
    const kind = String(it.kind || "custom");
    if (kind === "platform_license") {
      baseLicensePrice += row.lineNet;
    } else if (kind === "employees") {
      const q = Number(it.quantity);
      employeeCount += Number.isFinite(q) ? q : 0;
      employeeTotal += row.lineNet;
      const up = Number(it.unitPriceNet);
      if ((!employeePrice || employeePrice <= 0) && Number.isFinite(up) && up > 0) employeePrice = up;
    } else if (kind === "modules") {
      modulesTotal += row.lineNet;
    } else {
      modulesTotal += row.lineNet;
    }
  }
  baseLicensePrice = Math.round(baseLicensePrice * 100) / 100;
  modulesTotal = Math.round(modulesTotal * 100) / 100;
  employeeTotal = Math.round(employeeTotal * 100) / 100;
  employeePrice = Math.round(employeePrice * 100) / 100;

  const accRaw = String(provider.accountNumber || "").trim();
  const { accountNumber, bankCode, iban: parsedIban } = parsePaymentAccountString(accRaw);
  const ibanResolved =
    String(provider.iban || "").trim() ||
    (parsedIban ? parsedIban : convertToIban(accountNumber, bankCode) || "") ||
    null;
  const qrSnap = buildInvoicePaymentQr({
    iban: ibanResolved,
    bankAccountNumber: accountNumber,
    bankCode,
    amountGross,
    variableSymbol,
    message: `FA ${invoiceNumber}`.slice(0, 60),
  });
  const qrPaymentData = qrSnap
    ? { spd: qrSnap.spd, qrUrl: qrSnap.qrUrl, warning: qrSnap.warning }
    : { spd: "", qrUrl: "", warning: "QR nelze vytvořit." };
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
    totalAmount: amountGross,
    baseLicensePrice,
    modulesTotal,
    employeePrice,
    employeeCount,
    employeeTotal,
    qrPaymentData,
    issuedAt: issue,
    currency: "CZK",
    status: "unpaid",
    pdfUrl,
    storagePath,
    note: note?.trim() || null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
    paidAt: null,
    paymentClaimed: false,
    paymentClaimedAt: null,
    gracePeriodUntil: null,
    paymentClaimedByUid: null,
    graceDeactivationApplied: false,
    issueSource,
    issuedByAutomation: issueSource === "automation",
    ...(platformInvoiceSource ? { source: platformInvoiceSource } : {}),
    ...(moduleId ? { moduleId: String(moduleId) } : {}),
    ...(moduleName ? { moduleName: String(moduleName) } : {}),
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
