import {
  addDoc,
  collection,
  doc,
  getDoc,
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
  aggregateBudgetItemAmounts,
  applyAdvanceDeductionsToGross,
} from "@/lib/work-budget-financial-overview";
import { isNormalBudgetItem } from "@/lib/work-budget-types";
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

/** Položky pro novou fakturu nebo přegenerování existující (včetně již vázaných na tuto fakturu). */
export function workBudgetItemsEligibleForInvoice(
  items: JobWorkBudgetItemDoc[],
  regenerateInvoiceId?: string | null
): JobWorkBudgetItemDoc[] {
  const reg = String(regenerateInvoiceId ?? "").trim();
  return items.filter((row) => {
    if (!row.done || row.amountGross <= 0) return false;
    if (isExtraWorkItem(row) && !isApprovedExtraWorkItem(row)) return false;
    if (reg && row.linkedInvoiceId === reg) return true;
    if (!row.invoiced) return true;
    return false;
  });
}

export function billableWorkBudgetItems(items: JobWorkBudgetItemDoc[]): JobWorkBudgetItemDoc[] {
  return workBudgetItemsEligibleForInvoice(items, null);
}

export function isWorkBudgetSourceInvoice(inv: Record<string, unknown>): boolean {
  return inv.workBudgetSource === true;
}

export type WorkBudgetInvoiceRegenerateAssessment = {
  allowed: boolean;
  blockedReason?: string;
  manualEditWarning?: boolean;
};

export function assessWorkBudgetInvoiceRegeneration(
  inv: Record<string, unknown>
): WorkBudgetInvoiceRegenerateAssessment {
  if (!isWorkBudgetSourceInvoice(inv)) {
    return { allowed: false, blockedReason: "Faktura nevznikla z položkového rozpočtu." };
  }
  if (inv.isDeleted === true) {
    return { allowed: false, blockedReason: "Faktura byla smazána." };
  }
  const st = String(inv.status ?? "").trim().toLowerCase();
  if (st === "cancelled" || st === "storno" || inv.storno === true) {
    return { allowed: false, blockedReason: "Stornovanou fakturu nelze přegenerovat." };
  }
  const ps = String(inv.paymentStatus ?? "unpaid").trim().toLowerCase();
  if (ps === "paid") {
    return { allowed: false, blockedReason: "Zaplacenou fakturu nelze přegenerovat." };
  }
  if (ps === "partial" && Number(inv.paidAmount ?? inv.paidGrossReceived ?? 0) > 0) {
    return {
      allowed: false,
      blockedReason: "Částečně zaplacenou fakturu nelze přegenerovat.",
    };
  }
  let manualEditWarning = false;
  if (inv.workBudgetLinesPristine === false) {
    manualEditWarning = true;
  } else {
    const ids = Array.isArray(inv.workBudgetItemIds)
      ? (inv.workBudgetItemIds as string[])
      : [];
    const lineItems = Array.isArray(inv.items) ? inv.items : [];
    if (ids.length > 0 && lineItems.length > 0 && lineItems.length !== ids.length) {
      manualEditWarning = true;
    }
  }
  return { allowed: true, manualEditWarning };
}

export function isWorkBudgetInvoiceStale(params: {
  invoice: Record<string, unknown>;
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
}): boolean {
  if (!isWorkBudgetSourceInvoice(params.invoice)) return false;
  const inv = params.invoice;
  const invId = String(inv.id ?? "").trim();
  if (!invId) return false;
  const advanceIds = Array.isArray(inv.workBudgetAdvanceIds)
    ? (inv.workBudgetAdvanceIds as string[])
    : [];
  try {
    const preview = buildWorkBudgetInvoicePreview({
      items: params.items,
      advances: params.advances,
      selectedAdvanceIds: advanceIds,
      regenerateInvoiceId: invId,
    });
    const oldSub = roundMoney2(Number(inv.workBudgetSubtotalGross ?? 0));
    const oldPay = roundMoney2(Number(inv.amountGross ?? 0));
    const oldIds = new Set(
      Array.isArray(inv.workBudgetItemIds) ? (inv.workBudgetItemIds as string[]) : []
    );
    const newIds = new Set(preview.billableItems.map((r) => r.id));
    if (Math.abs(preview.subtotalGross - oldSub) > 0.009) return true;
    if (Math.abs(preview.amountGross - oldPay) > 0.009) return true;
    if (oldIds.size !== newIds.size) return true;
    for (const id of newIds) {
      if (!oldIds.has(id)) return true;
    }
    return false;
  } catch {
    return true;
  }
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
  regenerateInvoiceId?: string | null;
}): WorkBudgetInvoicePreview {
  const reg = String(params.regenerateInvoiceId ?? "").trim() || null;
  const billable = workBudgetItemsEligibleForInvoice(params.items, reg);
  const normal = aggregateBudgetItemAmounts(billable.filter(isNormalBudgetItem));
  const extraWork = aggregateBudgetItemAmounts(billable.filter(isApprovedExtraWorkItem));
  let subtotalNet = roundMoney2(normal.net + extraWork.net);
  let subtotalVat = roundMoney2(normal.vat + extraWork.vat);
  let subtotalGross = roundMoney2(normal.gross + extraWork.gross);

  const advancesApplied: WorkBudgetInvoicePreview["advancesApplied"] = [];
  let deductionGross = 0;
  const idSet = new Set(params.selectedAdvanceIds);
  for (const adv of params.advances) {
    if (!idSet.has(adv.id)) continue;
    if (adv.appliedToInvoiceId && adv.appliedToInvoiceId !== reg) {
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

type WorkBudgetInvoiceBuildInput = {
  jobDisplayName: string;
  customerId: string;
  customer: unknown;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  preview: WorkBudgetInvoicePreview;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  taxSupplyDate: string;
};

function buildWorkBudgetInvoiceNotes(preview: WorkBudgetInvoicePreview): string {
  let notes = "Faktura za provedené práce dle položkového rozpočtu zakázky.";
  if (preview.advancesApplied.length > 0) {
    notes += `\n\nZapočtené zálohy:\n${preview.advancesApplied
      .map((a) => `- ${a.label}: ${a.amountGross.toLocaleString("cs-CZ")} Kč`)
      .join("\n")}`;
    notes += `\n\nMezisoučet položek: ${preview.subtotalGross.toLocaleString("cs-CZ")} Kč s DPH`;
    notes += `\nOdečet záloh: -${preview.deductionGross.toLocaleString("cs-CZ")} Kč`;
    notes += `\nK úhradě: ${preview.amountGross.toLocaleString("cs-CZ")} Kč s DPH`;
  }
  return notes;
}

function buildWorkBudgetInvoiceHtmlBundle(input: WorkBudgetInvoiceBuildInput) {
  const billable = input.preview.billableItems;
  const invoiceLines = billable.map(workBudgetItemToInvoiceLine);
  const recipient = invoiceRecipientFromCustomerDoc(input.customerId, input.customer);
  const companyMeta = handoverCompanyPdfMeta(input.companyDoc);
  const c = input.companyDoc ?? {};
  const supplierIco = trim(c.ico ?? c.companyIco) || null;
  const supplierDic = trim(c.dic ?? c.companyDic) || null;
  const legacyCompanyBank = trim(c.bankAccount ?? c.companyBankAccount) || null;
  const notes = buildWorkBudgetInvoiceNotes(input.preview);

  const built = buildPortalManualInvoiceHtml({
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    taxSupplyDate: input.taxSupplyDate,
    jobName: input.jobDisplayName,
    notes,
    recipient,
    supplierName: companyMeta.contractorCompanyName,
    supplierAddressLines: buildCompanyRegisteredAddress(c) ?? companyMeta.companyAddressText,
    supplierIco,
    supplierDic,
    logoUrl: companyMeta.logoUrl,
    items: invoiceLines,
    orgBankAccounts: input.orgBankAccounts,
    legacyCompanyBankLine: legacyCompanyBank,
  });

  let { html, amountNet, vatAmount, amountGross, variableSymbol, vatBreakdown } = built;
  const preview = input.preview;
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

  return {
    billable,
    invoiceLines,
    recipient,
    html,
    amountNet,
    vatAmount,
    amountGross,
    variableSymbol,
    vatBreakdown,
    notes,
    displayName: recipientDisplayName(recipient),
    addrLines: buildRecipientAddressMultiline(recipient),
    itemIds: billable.map((row) => row.id),
  };
}

function writeWorkBudgetInvoiceLinksToBatch(params: {
  batch: ReturnType<typeof writeBatch>;
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
  allItems: JobWorkBudgetItemDoc[];
  previousItemIds: string[];
  billable: JobWorkBudgetItemDoc[];
  previousAdvanceIds: string[];
  appliedAdvanceIds: string[];
}): void {
  const invoicedAt = new Date().toISOString();
  const newItemSet = new Set(params.billable.map((r) => r.id));
  const prevItemSet = new Set(params.previousItemIds);
  const newAdvSet = new Set(params.appliedAdvanceIds);
  const prevAdvSet = new Set(params.previousAdvanceIds);
  const batch = params.batch;

  for (const row of params.allItems) {
    if (prevItemSet.has(row.id) && !newItemSet.has(row.id) && row.linkedInvoiceId === params.invoiceId) {
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
          invoiced: false,
          invoicedAt: null,
          linkedInvoiceId: null,
          updatedAt: serverTimestamp(),
        }
      );
    }
  }

  for (const row of params.billable) {
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
        linkedInvoiceId: params.invoiceId,
        updatedAt: serverTimestamp(),
      }
    );
  }

  for (const advId of prevAdvSet) {
    if (!newAdvSet.has(advId)) {
      batch.update(
        doc(
          params.firestore,
          "companies",
          params.companyId,
          "jobs",
          params.jobId,
          "workBudgetAdvances",
          advId
        ),
        {
          appliedToInvoiceId: null,
          updatedAt: serverTimestamp(),
        }
      );
    }
  }

  for (const advId of newAdvSet) {
    batch.update(
      doc(
        params.firestore,
        "companies",
        params.companyId,
        "jobs",
        params.jobId,
        "workBudgetAdvances",
        advId
      ),
      {
        appliedToInvoiceId: params.invoiceId,
        updatedAt: serverTimestamp(),
      }
    );
  }
}

async function applyWorkBudgetInvoiceLinks(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
  allItems: JobWorkBudgetItemDoc[];
  previousItemIds: string[];
  billable: JobWorkBudgetItemDoc[];
  previousAdvanceIds: string[];
  appliedAdvanceIds: string[];
}): Promise<void> {
  const batch = writeBatch(params.firestore);
  writeWorkBudgetInvoiceLinksToBatch({ ...params, batch });
  await batch.commit();
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
  if (preview.billableItems.length === 0) {
    throw new Error("Žádné provedené nevyfakturované položky k fakturaci.");
  }

  const issueDate = new Date().toISOString().split("T")[0];
  const dueDate = defaultDueDateIso();
  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "FA"
  );

  const bundle = buildWorkBudgetInvoiceHtmlBundle({
    jobDisplayName: params.jobDisplayName,
    customerId: params.customerId,
    customer: params.customer,
    companyDoc: params.companyDoc,
    orgBankAccounts: params.orgBankAccounts,
    preview,
    invoiceNumber,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
  });

  const basePayload = scrubFirestoreValue({
    type: PORTAL_MANUAL_INVOICE_TYPE,
    organizationId: params.companyId,
    companyId: params.companyId,
    jobId: params.jobId,
    customerId: params.customerId.trim() || null,
    invoiceRecipient: scrubFirestoreValue({
      type: bundle.recipient.type,
      name: bundle.recipient.name,
      companyName: bundle.recipient.companyName ?? null,
      ico: bundle.recipient.ico ?? null,
      dic: bundle.recipient.dic ?? null,
      street: bundle.recipient.street ?? null,
      city: bundle.recipient.city ?? null,
      postalCode: bundle.recipient.postalCode ?? null,
      country: bundle.recipient.country ?? null,
      email: bundle.recipient.email ?? null,
      phone: bundle.recipient.phone ?? null,
      recipientNote: bundle.recipient.recipientNote ?? null,
      sourceCustomerId: bundle.recipient.sourceCustomerId ?? null,
    }),
    customerName: bundle.displayName,
    customerAddressLines: bundle.addrLines || bundle.displayName,
    customerPhone: bundle.recipient.phone ?? null,
    customerEmail: bundle.recipient.email ?? null,
    customerIco: bundle.recipient.ico ?? null,
    customerDic: bundle.recipient.dic ?? null,
    invoiceNumber,
    items: portalFormItemsForFirestore(bundle.invoiceLines),
    totalAmount: bundle.amountGross,
    amountNet: bundle.amountNet,
    vatAmount: bundle.vatAmount,
    amountGross: bundle.amountGross,
    vatBreakdown: bundle.vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, vat: b.vat })),
    paymentStatus: "unpaid",
    requiresPayment: true,
    variableSymbol: bundle.variableSymbol,
    pdfHtml: bundle.html,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
    notes: bundle.notes,
    status: "draft",
    issueStatus: "issued",
    isDeleted: false,
    workBudgetSource: true,
    workBudgetItemIds: bundle.itemIds,
    workBudgetAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
    workBudgetSubtotalGross: preview.subtotalGross,
    workBudgetAdvanceDeductionGross: preview.deductionGross,
    workBudgetLinesPristine: true,
    workBudgetSyncedAt: serverTimestamp(),
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
    customerName: bundle.displayName,
    jobId: params.jobId,
    jobName: params.jobDisplayName !== "—" ? params.jobDisplayName : null,
    issueDate,
    dueDate,
    amountNet: bundle.amountNet,
    vatAmount: bundle.vatAmount,
    amountGross: bundle.amountGross,
  });

  await updateDoc(doc(params.firestore, "companies", params.companyId, "invoices", invRef.id), {
    linkedDocumentId: docId,
  });

  await addDoc(collection(params.firestore, "companies", params.companyId, "finance"), {
    amount: bundle.amountGross,
    type: "revenue",
    date: issueDate,
    description: `Faktura ${invoiceNumber}`,
    createdAt: serverTimestamp(),
  });

  await applyWorkBudgetInvoiceLinks({
    firestore: params.firestore,
    companyId: params.companyId,
    jobId: params.jobId,
    invoiceId: invRef.id,
    allItems: params.items,
    previousItemIds: [],
    billable: bundle.billable,
    previousAdvanceIds: [],
    appliedAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
  });

  return { invoiceId: invRef.id, invoiceNumber, amountGross: bundle.amountGross };
}

export async function regenerateInvoiceFromWorkBudgetItems(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
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
  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) {
    throw new Error("Faktura neexistuje.");
  }
  const inv = { id: invSnap.id, ...invSnap.data() } as Record<string, unknown>;
  if (String(inv.jobId ?? "") !== params.jobId) {
    throw new Error("Faktura nepatří k této zakázce.");
  }
  const assessment = assessWorkBudgetInvoiceRegeneration(inv);
  if (!assessment.allowed) {
    throw new Error(assessment.blockedReason ?? "Fakturu nelze přegenerovat.");
  }

  const preview = buildWorkBudgetInvoicePreview({
    items: params.items,
    advances: params.advances ?? [],
    selectedAdvanceIds: params.selectedAdvanceIds ?? [],
    regenerateInvoiceId: params.invoiceId,
  });
  if (preview.billableItems.length === 0) {
    throw new Error("Žádné položky k fakturaci podle aktuálního rozpočtu.");
  }

  const invoiceNumber = String(inv.invoiceNumber ?? "").trim();
  if (!invoiceNumber) {
    throw new Error("Faktura nemá číslo dokladu.");
  }
  const issueDate = String(inv.issueDate ?? new Date().toISOString().split("T")[0]).trim();
  const dueDate = String(inv.dueDate ?? defaultDueDateIso()).trim();
  const taxSupplyDate = String(inv.taxSupplyDate ?? issueDate).trim();

  const bundle = buildWorkBudgetInvoiceHtmlBundle({
    jobDisplayName: params.jobDisplayName,
    customerId: params.customerId,
    customer: params.customer,
    companyDoc: params.companyDoc,
    orgBankAccounts: params.orgBankAccounts,
    preview,
    invoiceNumber,
    issueDate,
    dueDate,
    taxSupplyDate,
  });

  const previousItemIds = Array.isArray(inv.workBudgetItemIds)
    ? (inv.workBudgetItemIds as string[])
    : [];
  const previousAdvanceIds = Array.isArray(inv.workBudgetAdvanceIds)
    ? (inv.workBudgetAdvanceIds as string[])
    : [];

  const updatePayload = scrubFirestoreValue({
    items: portalFormItemsForFirestore(bundle.invoiceLines),
    totalAmount: bundle.amountGross,
    amountNet: bundle.amountNet,
    vatAmount: bundle.vatAmount,
    amountGross: bundle.amountGross,
    vatBreakdown: bundle.vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, vat: b.vat })),
    pdfHtml: bundle.html,
    notes: bundle.notes,
    workBudgetItemIds: bundle.itemIds,
    workBudgetAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
    workBudgetSubtotalGross: preview.subtotalGross,
    workBudgetAdvanceDeductionGross: preview.deductionGross,
    workBudgetLinesPristine: true,
    workBudgetSyncedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }) as Record<string, unknown>;

  const batch = writeBatch(params.firestore);
  batch.update(invRef, updatePayload as Record<string, import("firebase/firestore").FieldValue>);
  writeWorkBudgetInvoiceLinksToBatch({
    batch,
    firestore: params.firestore,
    companyId: params.companyId,
    jobId: params.jobId,
    invoiceId: params.invoiceId,
    allItems: params.items,
    previousItemIds,
    billable: bundle.billable,
    previousAdvanceIds,
    appliedAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
  });
  await batch.commit();

  await syncPortalInvoiceToDocuments({
    firestore: params.firestore,
    companyId: params.companyId,
    invoiceId: params.invoiceId,
    userId: params.userId,
    uploadedByName: params.profileDisplayName ?? "Uživatel",
    invoiceNumber,
    customerName: bundle.displayName,
    jobId: params.jobId,
    jobName: params.jobDisplayName !== "—" ? params.jobDisplayName : null,
    issueDate,
    dueDate,
    amountNet: bundle.amountNet,
    vatAmount: bundle.vatAmount,
    amountGross: bundle.amountGross,
    linkedDocumentId:
      inv.linkedDocumentId != null ? String(inv.linkedDocumentId) : null,
  });

  return {
    invoiceId: params.invoiceId,
    invoiceNumber,
    amountGross: bundle.amountGross,
  };
}
