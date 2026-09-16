import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";
import {
  buildPortalManualInvoiceHtml,
  buildRecipientAddressMultiline,
  invoiceRecipientFromCustomerDoc,
  PORTAL_MANUAL_INVOICE_TYPE,
  portalFormItemsForFirestore,
  recipientDisplayName,
  scrubFirestoreValue,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { syncPortalInvoiceToDocuments } from "@/lib/portal-invoice-documents-sync";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  isApprovedExtraWorkItem,
  isExtraWorkItem,
} from "@/lib/work-budget-types";
import type { JobWorkBudgetAdvanceDoc } from "@/lib/work-budget-advances";
import {
  applyAdvanceDeductionsToGross,
  splitBillableByItemType,
} from "@/lib/work-budget-financial-overview";
import { roundMoney2 } from "@/lib/vat-calculations";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function defaultDueDateIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

export function formatWorkBudgetItemInvoiceDescription(item: JobWorkBudgetItemDoc): string {
  const title = trim(item.title);
  const desc = trim(item.description);
  const base = desc && desc !== title ? `${title} – ${desc}` : title || desc;
  if (isExtraWorkItem(item)) {
    return base ? `VÍCEPRÁCE – ${base}` : "VÍCEPRÁCE";
  }
  return base;
}

function workBudgetItemToInvoiceLine(item: JobWorkBudgetItemDoc): PortalManualFormItem {
  const description = formatWorkBudgetItemInvoiceDescription(item);
  return {
    id: item.id,
    description,
    quantity: item.quantity,
    unitPrice: item.unitPriceNet,
    priceType: "net",
    vatRate: item.vatRate,
    unit: item.unit || "ks",
    inventoryItemId: null,
    imageUrl: null,
  };
}

export function billableWorkBudgetItems(items: JobWorkBudgetItemDoc[]): JobWorkBudgetItemDoc[] {
  return items.filter(
    (row) =>
      row.done &&
      !row.invoiced &&
      row.amountGross > 0 &&
      (!isExtraWorkItem(row) || isApprovedExtraWorkItem(row))
  );
}

export type WorkBudgetInvoicePreview = {
  billableItems: JobWorkBudgetItemDoc[];
  linesNormalGross: number;
  linesExtraGross: number;
  subtotalNet: number;
  subtotalVat: number;
  subtotalGross: number;
  deductionGross: number;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  advancesApplied: Array<{ advanceId: string; label: string; amountGross: number }>;
};

export function buildWorkBudgetInvoicePreview(params: {
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  selectedAdvanceIds: string[];
}): WorkBudgetInvoicePreview {
  const billable = billableWorkBudgetItems(params.items);
  const { normal, extraWork } = splitBillableByItemType(billable);
  let subtotalNet = roundMoney2(normal.net + extraWork.net);
  let subtotalVat = roundMoney2(normal.vat + extraWork.vat);
  let subtotalGross = roundMoney2(normal.gross + extraWork.gross);

  const advancesApplied: WorkBudgetInvoicePreview["advancesApplied"] = [];
  let deductionGross = 0;
  const idSet = new Set(params.selectedAdvanceIds);
  for (const adv of params.advances) {
    if (!idSet.has(adv.id)) continue;
    if (adv.appliedToInvoiceId) {
      throw new Error(`Záloha „${adv.label}“ už byla započtena jinou fakturou.`);
    }
    deductionGross = roundMoney2(deductionGross + adv.amountGross);
    advancesApplied.push({
      advanceId: adv.id,
      label: adv.label,
      amountGross: adv.amountGross,
    });
  }

  const after = applyAdvanceDeductionsToGross({
    subtotalNet,
    subtotalVat,
    subtotalGross,
    deductionGross,
  });

  return {
    billableItems: billable,
    linesNormalGross: normal.gross,
    linesExtraGross: extraWork.gross,
    subtotalNet,
    subtotalVat,
    subtotalGross,
    deductionGross: after.deductionGross,
    amountNet: after.net,
    vatAmount: after.vat,
    amountGross: after.gross,
    advancesApplied,
  };
}

export async function createInvoiceFromWorkBudgetItems(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string;
  customerId: string;
  customer: unknown;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  items: JobWorkBudgetItemDoc[];
  advances?: JobWorkBudgetAdvanceDoc[];
  selectedAdvanceIds?: string[];
  userId: string;
  profileDisplayName?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string; amountGross: number }> {
  const preview = buildWorkBudgetInvoicePreview({
    items: params.items,
    advances: params.advances ?? [],
    selectedAdvanceIds: params.selectedAdvanceIds ?? [],
  });
  const billable = preview.billableItems;
  if (billable.length === 0) {
    throw new Error("Žádné provedené nevyfakturované položky k fakturaci.");
  }

  const invoiceLines = billable.map(workBudgetItemToInvoiceLine);
  const recipient = invoiceRecipientFromCustomerDoc(params.customerId, params.customer);
  const companyMeta = handoverCompanyPdfMeta(params.companyDoc);
  const c = params.companyDoc ?? {};
  const supplierIco = trim(c.ico ?? c.companyIco) || null;
  const supplierDic = trim(c.dic ?? c.companyDic) || null;
  const legacyCompanyBank = trim(c.bankAccount ?? c.companyBankAccount) || null;

  const issueDate = new Date().toISOString().split("T")[0];
  const dueDate = defaultDueDateIso();
  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "FA"
  );

  let notes = "Faktura za provedené práce dle položkového rozpočtu zakázky.";
  if (preview.advancesApplied.length > 0) {
    notes += `\n\nZapočtené zálohy:\n${preview.advancesApplied
      .map((a) => `- ${a.label}: ${a.amountGross.toLocaleString("cs-CZ")} Kč`)
      .join("\n")}`;
    notes += `\n\nMezisoučet položek: ${preview.subtotalGross.toLocaleString("cs-CZ")} Kč s DPH`;
    notes += `\nOdečet záloh: -${preview.deductionGross.toLocaleString("cs-CZ")} Kč`;
    notes += `\nK úhradě: ${preview.amountGross.toLocaleString("cs-CZ")} Kč s DPH`;
  }

  const built = buildPortalManualInvoiceHtml({
    invoiceNumber,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
    jobName: params.jobDisplayName,
    notes,
    recipient,
    supplierName: companyMeta.contractorCompanyName,
    supplierAddressLines: buildCompanyRegisteredAddress(c) ?? companyMeta.companyAddressText,
    supplierIco,
    supplierDic,
    logoUrl: companyMeta.logoUrl,
    items: invoiceLines,
    orgBankAccounts: params.orgBankAccounts,
    legacyCompanyBankLine: legacyCompanyBank,
  });

  let { html, amountNet, vatAmount, amountGross, variableSymbol, vatBreakdown } = built;
  if (preview.deductionGross > 0) {
    amountNet = preview.amountNet;
    vatAmount = preview.vatAmount;
    amountGross = preview.amountGross;
    if (amountGross > 0 && vatBreakdown.length === 1) {
      const ratio = preview.subtotalGross > 0 ? preview.amountGross / preview.subtotalGross : 1;
      vatBreakdown = vatBreakdown.map((b) => ({
        rate: b.rate,
        base: roundMoney2(b.base * ratio),
        vat: roundMoney2(b.vat * ratio),
      }));
    }
  }
  const displayName = recipientDisplayName(recipient);
  const addrLines = buildRecipientAddressMultiline(recipient);
  const itemIds = billable.map((row) => row.id);

  const basePayload = scrubFirestoreValue({
    type: PORTAL_MANUAL_INVOICE_TYPE,
    organizationId: params.companyId,
    companyId: params.companyId,
    jobId: params.jobId,
    customerId: params.customerId.trim() || null,
    invoiceRecipient: scrubFirestoreValue({
      type: recipient.type,
      name: recipient.name,
      companyName: recipient.companyName ?? null,
      ico: recipient.ico ?? null,
      dic: recipient.dic ?? null,
      street: recipient.street ?? null,
      city: recipient.city ?? null,
      postalCode: recipient.postalCode ?? null,
      country: recipient.country ?? null,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      recipientNote: recipient.recipientNote ?? null,
      sourceCustomerId: recipient.sourceCustomerId ?? null,
    }),
    customerName: displayName,
    customerAddressLines: addrLines || displayName,
    customerPhone: recipient.phone ?? null,
    customerEmail: recipient.email ?? null,
    customerIco: recipient.ico ?? null,
    customerDic: recipient.dic ?? null,
    invoiceNumber,
    items: portalFormItemsForFirestore(invoiceLines),
    totalAmount: amountGross,
    amountNet,
    vatAmount,
    amountGross,
    vatBreakdown: vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, vat: b.vat })),
    paymentStatus: "unpaid",
    requiresPayment: true,
    variableSymbol,
    pdfHtml: html,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
    notes: "Faktura za provedené práce dle položkového rozpočtu zakázky.",
    status: "draft",
    issueStatus: "issued",
    isDeleted: false,
    workBudgetSource: true,
    workBudgetItemIds: itemIds,
    workBudgetAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
    workBudgetSubtotalGross: preview.subtotalGross,
    workBudgetAdvanceDeductionGross: preview.deductionGross,
    createdAt: serverTimestamp(),
    createdBy: params.userId,
    updatedAt: serverTimestamp(),
  }) as Record<string, unknown>;

  const invRef = await addDoc(
    collection(params.firestore, "companies", params.companyId, "invoices"),
    basePayload
  );

  const docId = await syncPortalInvoiceToDocuments({
    firestore: params.firestore,
    companyId: params.companyId,
    invoiceId: invRef.id,
    userId: params.userId,
    uploadedByName: params.profileDisplayName ?? "Uživatel",
    invoiceNumber,
    customerName: displayName,
    jobId: params.jobId,
    jobName: params.jobDisplayName !== "—" ? params.jobDisplayName : null,
    issueDate,
    dueDate,
    amountNet,
    vatAmount,
    amountGross,
  });

  await updateDoc(doc(params.firestore, "companies", params.companyId, "invoices", invRef.id), {
    linkedDocumentId: docId,
  });

  await addDoc(collection(params.firestore, "companies", params.companyId, "finance"), {
    amount: amountGross,
    type: "revenue",
    date: issueDate,
    description: `Faktura ${invoiceNumber}`,
    createdAt: serverTimestamp(),
  });

  const invoicedAt = new Date().toISOString();
  const batch = writeBatch(params.firestore);
  for (const row of billable) {
    batch.update(
      doc(
        params.firestore,
        "companies",
        params.companyId,
        "jobs",
        params.jobId,
        "workBudgetItems",
        row.id
      ),
      {
        invoiced: true,
        invoicedAt,
        linkedInvoiceId: invRef.id,
        updatedAt: serverTimestamp(),
      }
    );
  }
  for (const adv of preview.advancesApplied) {
    batch.update(
      doc(
        params.firestore,
        "companies",
        params.companyId,
        "jobs",
        params.jobId,
        "workBudgetAdvances",
        adv.advanceId
      ),
      {
        appliedToInvoiceId: invRef.id,
        updatedAt: serverTimestamp(),
      }
    );
  }
  await batch.commit();

  return { invoiceId: invRef.id, invoiceNumber, amountGross };
}
