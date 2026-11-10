import {
  buildAdvanceInvoiceHtml,
  buildFinalSettlementInvoiceHtml,
  buildTaxReceiptHtml,
  type InvoiceLineRow,
  type SettlementAdvanceRow,
} from "@/lib/invoice-a4-html";
import {
  buildInvoicePaymentQr,
  formatBankBlockPlainLines,
  formatCustomerPartyLines,
  formatSupplierPartyLines,
  resolveBankSnapshotFromInvoiceDoc,
  type OrgBankAccountRow,
} from "@/lib/invoice-billing-meta";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import {
  buildPortalManualInvoiceHtml,
  parseInvoiceRecipientFromInvoiceDoc,
  parsePortalManualFormItemFromFirestore,
  paymentMessagePortalManual,
  PORTAL_MANUAL_INVOICE_TYPE,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { parsePortalInvoiceDocumentDiscount } from "@/lib/portal-invoice-discount";
import { normalizeVatRate, roundMoney2 } from "@/lib/vat-calculations";
import { buildWorkBudgetAdvanceSettlementFromInvoiceDoc } from "@/lib/work-budget-invoice-settlement";
import {
  invoiceRecipientDisplayName,
  snapshotFromInvoiceRecord,
} from "@/lib/invoice-customer-snapshot";
import {
  INVOICE_PDF_TEMPLATE_VERSION,
  upgradeLegacyInvoiceHtmlCss,
} from "@/lib/invoice-pdf-template";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function paymentMessageJob(invoiceNumber: string, jobName: string): string {
  const inv = trim(invoiceNumber);
  const job = trim(jobName);
  if (inv && job) return `${inv} - ${job}`;
  return inv || job || "Platba faktury";
}

export function invoiceLineRowsFromFirestoreItems(doc: Record<string, unknown>): InvoiceLineRow[] {
  const items = Array.isArray(doc.items) ? doc.items : [];
  return items.map((raw) => {
    const it = raw as Record<string, unknown>;
    const lineNet = Number(it.lineNet) || 0;
    const lineGross = Number(it.lineGross) || 0;
    const lineVat = Number(it.lineVat) || 0;
    return {
      description: trim(it.description) || "Položka",
      quantity: Math.max(0, Number(it.quantity) || 0),
      unit: trim(it.unit) || "ks",
      unitPriceNet: roundMoney2(Number(it.unitPriceNet ?? it.unitPrice) || 0),
      vatRate: normalizeVatRate(Number(it.vatRate) || 21),
      lineNet: roundMoney2(lineNet),
      lineVat: roundMoney2(lineVat),
      lineGross: roundMoney2(lineGross),
      lineNetBeforeDiscount:
        typeof it.lineNetBeforeDiscount === "number" ? roundMoney2(it.lineNetBeforeDiscount) : undefined,
      discountAmount: typeof it.discountAmount === "number" ? roundMoney2(it.discountAmount) : undefined,
      discountType:
        it.discountType === "percent" || it.discountType === "fixed" ? it.discountType : undefined,
      discountValue: typeof it.discountValue === "number" ? it.discountValue : undefined,
    };
  });
}

function customerPartyFromInvoiceDoc(doc: Record<string, unknown>): {
  customerName: string;
  customerParty: string;
} {
  const snap = snapshotFromInvoiceRecord(doc);
  const customerName = trim(doc.customerName) || invoiceRecipientDisplayName(snap);
  const addr =
    trim(doc.customerAddressLines) ||
    [trim(snap.street), trim(snap.city), trim(snap.postalCode)].filter(Boolean).join("\n");
  const customerParty = formatCustomerPartyLines(
    customerName,
    addr || customerName,
    trim(doc.customerPhone) || trim(snap.phone) || null,
    trim(doc.customerEmail) || trim(snap.email) || null,
    trim(doc.customerIco) || trim(snap.ico) || null,
    trim(doc.customerDic) || trim(snap.dic) || null
  );
  return { customerName, customerParty };
}

function supplierContext(companyDoc: Record<string, unknown>) {
  const meta = handoverCompanyPdfMeta(companyDoc);
  const supplierParty = formatSupplierPartyLines({
    companyName: meta.contractorCompanyName,
    addressLines: buildCompanyRegisteredAddress(companyDoc) ?? meta.companyAddressText,
    ico: trim(companyDoc.ico ?? companyDoc.companyIco) || null,
    dic: trim(companyDoc.dic ?? companyDoc.companyDic) || null,
  });
  const legacyBank = trim(companyDoc.bankAccount ?? companyDoc.companyBankAccount) || null;
  return { meta, supplierParty, legacyBank, supplierName: meta.contractorCompanyName };
}

function bankAndQr(
  doc: Record<string, unknown>,
  orgBankAccounts: OrgBankAccountRow[],
  legacyBank: string | null,
  invoiceNumber: string,
  jobName: string,
  amountGross: number,
  dueDate: string,
  variableSymbol: string,
  usePortalMessage = false
) {
  const bankSnap = resolveBankSnapshotFromInvoiceDoc(doc, orgBankAccounts);
  const bankText = formatBankBlockPlainLines(bankSnap, {
    variableSymbol,
    amountGross: Number.isFinite(amountGross) ? amountGross : undefined,
    dueDate: dueDate || undefined,
    currency: "CZK",
  });
  const vs = variableSymbol;
  const msg = usePortalMessage
    ? paymentMessagePortalManual(invoiceNumber, jobName)
    : paymentMessageJob(invoiceNumber, jobName);
  const qr = buildInvoicePaymentQr({
    iban: bankSnap.iban,
    bankAccountNumber: bankSnap.bankAccountNumber,
    bankCode: bankSnap.bankCode,
    amountGross,
    variableSymbol: vs,
    message: msg,
  });
  return {
    bankText,
    paymentQrUrl: qr?.warning ? null : qr?.qrUrl ?? null,
    paymentQrWarning: qr?.warning ?? null,
  };
}

export type RebuildInvoiceHtmlInput = {
  invoiceDoc: Record<string, unknown>;
  companyDoc: Record<string, unknown>;
  orgBankAccounts: OrgBankAccountRow[];
  /** Číslo zálohové faktury u daňového dokladu */
  relatedAdvanceInvoiceNumber?: string | null;
};

export type RebuildInvoiceHtmlResult =
  | { ok: true; html: string; templateVersion: number }
  | { ok: false; reason: string };

export function rebuildInvoiceHtmlFromDocument(
  input: RebuildInvoiceHtmlInput
): RebuildInvoiceHtmlResult {
  const doc = input.invoiceDoc;
  const invType = trim(doc.type);
  const { meta, supplierParty, legacyBank, supplierName } = supplierContext(input.companyDoc);
  const jobName = trim(doc.jobName) || trim(doc.jobDisplayName) || "Zakázka";
  const issueDate = trim(doc.issueDate) || new Date().toISOString().slice(0, 10);
  const dueDate = trim(doc.dueDate) || issueDate;
  const taxSupplyDate = trim(doc.taxSupplyDate) || issueDate;
  const invoiceNumber = trim(doc.invoiceNumber) || trim(doc.documentNumber) || "doklad";
  const vs =
    trim(doc.variableSymbol) || invoiceNumber.replace(/\D/g, "").slice(-10) || invoiceNumber;
  const amountNet = roundMoney2(Number(doc.amountNet) || 0);
  const vatAmount = roundMoney2(Number(doc.vatAmount) || 0);
  const amountGross = roundMoney2(Number(doc.amountGross) || Number(doc.totalAmount) || 0);
  const { customerName, customerParty } = customerPartyFromInvoiceDoc(doc);
  const { bankText, paymentQrUrl, paymentQrWarning } = bankAndQr(
    doc,
    input.orgBankAccounts,
    legacyBank,
    invoiceNumber,
    jobName,
    amountGross,
    dueDate,
    vs,
    invType === PORTAL_MANUAL_INVOICE_TYPE
  );

  try {
    if (invType === PORTAL_MANUAL_INVOICE_TYPE) {
      const recipient = parseInvoiceRecipientFromInvoiceDoc(doc);
      if (!recipient) return { ok: false, reason: "Chybí odběratel v dokladu." };
      const itemsRaw = Array.isArray(doc.items) ? doc.items : [];
      const items: PortalManualFormItem[] = itemsRaw.map((row, idx) =>
        parsePortalManualFormItemFromFirestore(row as Record<string, unknown>, idx)
      );
      if (items.length === 0) return { ok: false, reason: "Doklad nemá položky." };
      const advanceSettlement = buildWorkBudgetAdvanceSettlementFromInvoiceDoc(doc, items);
      const built = buildPortalManualInvoiceHtml({
        invoiceNumber,
        issueDate,
        dueDate,
        taxSupplyDate,
        jobName,
        notes: trim(doc.notes) || null,
        recipient,
        supplierName,
        supplierAddressLines:
          buildCompanyRegisteredAddress(input.companyDoc) ?? meta.companyAddressText,
        supplierIco: trim(input.companyDoc.ico ?? input.companyDoc.companyIco) || null,
        supplierDic: trim(input.companyDoc.dic ?? input.companyDoc.companyDic) || null,
        logoUrl: meta.logoUrl,
        items,
        orgBankAccounts: input.orgBankAccounts,
        overrideBankAccountId: trim(doc.bankAccountId) || null,
        legacyCompanyBankLine: legacyBank,
        advanceSettlement,
        invoiceDiscount: parsePortalInvoiceDocumentDiscount(doc),
      });
      return { ok: true, html: built.html, templateVersion: INVOICE_PDF_TEMPLATE_VERSION };
    }

    if (invType === JOB_INVOICE_TYPES.ADVANCE) {
      const rows = invoiceLineRowsFromFirestoreItems(doc);
      if (rows.length === 0) {
        return { ok: false, reason: "Zálohová faktura nemá položky." };
      }
      const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);
      const html = buildAdvanceInvoiceHtml({
        logoUrl: meta.logoUrl,
        title: "Zálohová faktura",
        supplierName,
        supplierAddressText: supplierParty,
        customerName,
        customerAddressText: customerParty,
        invoiceNumber,
        issueDate,
        taxSupplyDate,
        dueDate,
        jobName,
        contractNumber: doc.contractNumber != null ? String(doc.contractNumber) : null,
        variableSymbol: vs,
        bankAccountText: bankText,
        paymentDueDate: dueDate,
        paymentQrUrl,
        paymentQrWarning,
        items: rows,
        amountNet,
        vatAmount,
        amountGross,
        primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
        note: trim(doc.notes) || "Doklad slouží jako zálohová faktura dle smlouvy o dílo.",
      });
      return { ok: true, html, templateVersion: INVOICE_PDF_TEMPLATE_VERSION };
    }

    if (invType === JOB_INVOICE_TYPES.TAX_RECEIPT) {
      const documentNumber = trim(doc.documentNumber) || invoiceNumber;
      const paymentDate = trim(doc.paymentDate) || issueDate;
      const taxSupply = trim(doc.taxSupplyDate) || paymentDate;
      const vatRate = normalizeVatRate(Number(doc.vatRate) || 21);
      const relatedNum = trim(input.relatedAdvanceInvoiceNumber) || "—";
      const html = buildTaxReceiptHtml({
        logoUrl: meta.logoUrl,
        supplierName,
        supplierAddressText: supplierParty,
        customerName,
        customerAddressText: customerParty,
        documentNumber,
        issueDate: trim(doc.issueDate) || paymentDate,
        taxSupplyDate: taxSupply,
        paymentDate,
        relatedInvoiceNumber: relatedNum,
        jobName,
        amountNet,
        vatRate,
        vatAmount,
        amountGross,
        variableSymbol: vs,
        bankAccountText: bankText,
        paymentQrUrl,
        paymentQrWarning,
        note: trim(doc.note) || trim(doc.notes) || undefined,
      });
      return { ok: true, html, templateVersion: INVOICE_PDF_TEMPLATE_VERSION };
    }

    if (invType === JOB_INVOICE_TYPES.FINAL_INVOICE) {
      const rows = invoiceLineRowsFromFirestoreItems(doc);
      const totalContractGross = roundMoney2(
        Number(doc.totalContractAmount) || amountGross + Number(doc.totalAdvancePaid || 0)
      );
      const totalAdvancePaid = roundMoney2(Number(doc.totalAdvancePaid) || 0);
      const advanceRows: SettlementAdvanceRow[] =
        totalAdvancePaid > 0
          ? [{ label: "Odečtené zálohy", amountGross: totalAdvancePaid }]
          : [{ label: "Žádná evidovaná záloha", amountGross: 0 }];
      const allSameVat = rows.length > 0 && rows.every((r) => r.vatRate === rows[0].vatRate);
      const html = buildFinalSettlementInvoiceHtml({
        logoUrl: meta.logoUrl,
        supplierName,
        supplierAddressText: supplierParty,
        customerName,
        customerAddressText: customerParty,
        invoiceNumber,
        issueDate,
        taxSupplyDate,
        dueDate,
        jobName,
        contractNumber: doc.contractNumber != null ? String(doc.contractNumber) : null,
        variableSymbol: vs,
        bankAccountText: bankText,
        paymentDueDate: dueDate,
        paymentQrUrl,
        paymentQrWarning,
        totalContractGross,
        advanceRows,
        totalAdvancePaid,
        items: rows,
        amountNet,
        vatAmount,
        amountGross,
        primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
        note:
          trim(doc.notes) || "Doklad dokončuje vyúčtování zakázky po odečtení uhrazených záloh.",
      });
      return { ok: true, html, templateVersion: INVOICE_PDF_TEMPLATE_VERSION };
    }

    return { ok: false, reason: `Nepodporovaný typ dokladu: ${invType || "?"}` };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Nepodařilo sestavit HTML z dat dokladu.",
    };
  }
}

export function resolveInvoiceDisplayHtml(params: {
  invoiceDoc: Record<string, unknown>;
  companyDoc?: Record<string, unknown> | null;
  orgBankAccounts?: OrgBankAccountRow[];
  relatedAdvanceInvoiceNumber?: string | null;
}): {
  html: string;
  source: "preview_cache" | "rebuilt" | "original" | "css_upgraded";
  templateVersion: number;
  hasOriginalArchive: boolean;
} {
  const doc = params.invoiceDoc;
  const original = String(doc.pdfHtml ?? "").trim();
  const archive = String(doc.pdfHtmlArchive ?? "").trim();
  const preview = String(doc.pdfHtmlPreview ?? "").trim();
  const previewVer =
    typeof doc.pdfHtmlPreviewVersion === "number" ? doc.pdfHtmlPreviewVersion : 0;

  if (preview && previewVer >= INVOICE_PDF_TEMPLATE_VERSION) {
    return {
      html: preview,
      source: "preview_cache",
      templateVersion: previewVer,
      hasOriginalArchive: Boolean(archive || original),
    };
  }

  if (params.companyDoc && params.orgBankAccounts) {
    const rebuilt = rebuildInvoiceHtmlFromDocument({
      invoiceDoc: doc,
      companyDoc: params.companyDoc,
      orgBankAccounts: params.orgBankAccounts,
      relatedAdvanceInvoiceNumber: params.relatedAdvanceInvoiceNumber,
    });
    if (rebuilt.ok) {
      return {
        html: rebuilt.html,
        source: "rebuilt",
        templateVersion: rebuilt.templateVersion,
        hasOriginalArchive: Boolean(archive || original),
      };
    }
  }

  if (original) {
    return {
      html: upgradeLegacyInvoiceHtmlCss(original),
      source: "css_upgraded",
      templateVersion: readIssuedVersion(doc),
      hasOriginalArchive: Boolean(archive),
    };
  }

  return {
    html: "",
    source: "original",
    templateVersion: 0,
    hasOriginalArchive: false,
  };
}

function readIssuedVersion(doc: Record<string, unknown>): number {
  const v = doc.invoicePdfTemplateVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
