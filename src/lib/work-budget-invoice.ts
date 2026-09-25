import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
  parseInvoiceRecipientFromInvoiceDoc,
  PORTAL_MANUAL_INVOICE_TYPE,
  portalFormItemsForFirestore,
  recipientDisplayName,
  scrubFirestoreValue,
  computePortalManualInvoiceTotals,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { syncPortalInvoiceToDocuments } from "@/lib/portal-invoice-documents-sync";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  isApprovedExtraWorkItem,
  isExtraWorkItem,
  parseJobWorkBudgetItemFromFirestore,
  WORK_BUDGET_ITEMS_COLLECTION,
} from "@/lib/work-budget-types";
import type { JobWorkBudgetAdvanceDoc } from "@/lib/work-budget-advances";
import {
  isAdvanceAvailableForInvoice,
  WORK_BUDGET_ADVANCE_PAYMENT_STATUS,
} from "@/lib/work-budget-advances";
import {
  aggregateBudgetItemAmounts,
  applyAdvanceDeductionsToGross,
} from "@/lib/work-budget-financial-overview";
import { isNormalBudgetItem } from "@/lib/work-budget-types";
import { roundMoney2 } from "@/lib/vat-calculations";
import { buildWorkBudgetAdvanceSettlement } from "@/lib/work-budget-invoice-settlement";
import {
  assertWorkBudgetInvoiceSelectionValid,
  buildBillSlicesForInvoice,
  buildBillSlicesFromManualInvoiceLines,
  filterItemsByBillingScope,
  mergeInvoiceItemLink,
  removeInvoiceItemLink,
  sumInvoicedFromLinks,
  workBudgetItemHasBillableRemainder,
  type WorkBudgetBillSlice,
  type WorkBudgetBillingScope,
} from "@/lib/work-budget-invoicing";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function defaultDueDateIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

/** Odstraní prefix vícepráce z textu (zabrání dvojitému prefixu při opakovaném přegenerování). */
const INVOICE_EXTRA_WORK_PREFIX = /^VÍCEPRÁCE\s*[–—-]\s*/iu;

function stripInvoiceExtraWorkPrefix(text: string): string {
  let s = text.trim();
  while (INVOICE_EXTRA_WORK_PREFIX.test(s)) {
    s = s.replace(INVOICE_EXTRA_WORK_PREFIX, "").trim();
  }
  return s;
}

function workBudgetItemDescriptionBase(item: JobWorkBudgetItemDoc): string {
  const title = stripInvoiceExtraWorkPrefix(trim(item.title));
  const desc = stripInvoiceExtraWorkPrefix(trim(item.description));
  return desc && desc !== title ? `${title} – ${desc}` : title || desc;
}

export function formatWorkBudgetItemInvoiceDescription(item: JobWorkBudgetItemDoc): string {
  const base = workBudgetItemDescriptionBase(item);
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

function workBudgetSliceToInvoiceLine(
  slice: WorkBudgetBillSlice,
  budgetCatalog: JobWorkBudgetItemDoc[]
): PortalManualFormItem {
  const item = resolveWorkBudgetItemFromCatalog(slice.item, budgetCatalog);
  const description = formatWorkBudgetItemInvoiceDescription(item);
  const qty = slice.billQuantity > 0 ? slice.billQuantity : item.quantity;
  const unitNet = qty > 0 ? roundMoney2(slice.billNet / qty) : slice.billNet;
  return {
    id: item.id,
    description,
    quantity: qty,
    unitPrice: unitNet,
    priceType: "net",
    vatRate: item.vatRate,
    unit: item.unit || "ks",
    inventoryItemId: null,
    imageUrl: null,
  };
}

function aggregateBillSlices(
  slices: WorkBudgetBillSlice[],
  predicate: (item: JobWorkBudgetItemDoc) => boolean
): { net: number; vat: number; gross: number } {
  let net = 0;
  let gross = 0;
  for (const s of slices) {
    if (!predicate(s.item)) continue;
    net += s.billNet;
    gross += s.billGross;
  }
  net = roundMoney2(net);
  gross = roundMoney2(gross);
  return { net, vat: roundMoney2(gross - net), gross };
}

/** Zdroj pravdy pro typ položky je vždy aktuální záznam z položkového rozpočtu (podle id). */
export function resolveWorkBudgetItemFromCatalog(
  row: JobWorkBudgetItemDoc,
  budgetCatalog: JobWorkBudgetItemDoc[]
): JobWorkBudgetItemDoc {
  const found = budgetCatalog.find((r) => r.id === row.id);
  return found ?? row;
}

/** Společné mapování rozpočtových položek na řádky faktury (CREATE i REGENERATE). */
export function buildInvoiceLinesFromWorkBudgetItems(
  billable: JobWorkBudgetItemDoc[],
  budgetCatalog: JobWorkBudgetItemDoc[]
): PortalManualFormItem[] {
  return billable.map((row) =>
    workBudgetItemToInvoiceLine(resolveWorkBudgetItemFromCatalog(row, budgetCatalog))
  );
}

export function buildInvoiceLinesFromBillSlices(
  slices: WorkBudgetBillSlice[],
  budgetCatalog: JobWorkBudgetItemDoc[]
): PortalManualFormItem[] {
  return slices.map((slice) => workBudgetSliceToInvoiceLine(slice, budgetCatalog));
}

async function fetchJobWorkBudgetItemsFromFirestore(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<JobWorkBudgetItemDoc[]> {
  const snap = await getDocs(
    collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION)
  );
  return snap.docs.map((d) =>
    parseJobWorkBudgetItemFromFirestore(d.data() as Record<string, unknown>, d.id)
  );
}

/** Položky pro novou fakturu nebo přegenerování existující (včetně již vázaných na tuto fakturu). */
export function workBudgetItemsEligibleForInvoice(
  items: JobWorkBudgetItemDoc[],
  regenerateInvoiceId?: string | null
): JobWorkBudgetItemDoc[] {
  return items.filter((row) =>
    workBudgetItemHasBillableRemainder(row, regenerateInvoiceId)
  );
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
    const scopeRaw = String(inv.workBudgetBillingScope ?? "").trim();
    const billingScope: WorkBudgetBillingScope =
      scopeRaw === "base" ||
      scopeRaw === "extra_only" ||
      scopeRaw === "manual" ||
      scopeRaw === "base_and_extra"
        ? scopeRaw
        : "base_and_extra";
    const preview = buildWorkBudgetInvoicePreview({
      items: params.items,
      advances: params.advances,
      selectedAdvanceIds: advanceIds,
      regenerateInvoiceId: invId,
      billingScope,
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
  billSlices: WorkBudgetBillSlice[];
  billingScope: WorkBudgetBillingScope;
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
  /** Zálohy nad fakturovanou částkou (amountDue = 0) */
  overpaymentGross?: number;
};

export type WorkBudgetInvoiceAmounts = {
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  appliedAdvanceTotal: number;
  amountDue: number;
  amountDueNet: number;
  amountDueVat: number;
  advancesApplied: WorkBudgetInvoicePreview["advancesApplied"];
  billableItems: JobWorkBudgetItemDoc[];
};

function isAdvanceEligibleForInvoiceDeduction(
  adv: JobWorkBudgetAdvanceDoc,
  regenerateInvoiceId: string | null
): boolean {
  if (adv.amountGross <= 0) return false;
  if (adv.includeInFinalInvoice === false) return false;
  if (adv.paymentStatus === WORK_BUDGET_ADVANCE_PAYMENT_STATUS.UNPAID) return false;
  if (!isAdvanceAvailableForInvoice(adv, regenerateInvoiceId)) return false;
  return true;
}

/** Společný výpočet CREATE + REGENERATE: položky rozpočtu a započtené zálohy. */
export function buildInvoiceFromBudgetAndAdvances(params: {
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  selectedAdvanceIds: string[];
  regenerateInvoiceId?: string | null;
  billingScope?: WorkBudgetBillingScope;
  selectedItemIds?: string[];
  partialNetByItemId?: Record<string, number>;
}): WorkBudgetInvoiceAmounts & WorkBudgetInvoicePreview {
  const preview = buildWorkBudgetInvoicePreview(params);
  return {
    ...preview,
    netTotal: preview.subtotalNet,
    taxTotal: preview.subtotalVat,
    grossTotal: preview.subtotalGross,
    appliedAdvanceTotal: preview.deductionGross,
    amountDue: preview.amountGross,
    amountDueNet: preview.amountNet,
    amountDueVat: preview.vatAmount,
  };
}

export function buildWorkBudgetInvoicePreview(params: {
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  selectedAdvanceIds: string[];
  regenerateInvoiceId?: string | null;
  billingScope?: WorkBudgetBillingScope;
  selectedItemIds?: string[];
  partialNetByItemId?: Record<string, number>;
}): WorkBudgetInvoicePreview {
  const reg = String(params.regenerateInvoiceId ?? "").trim() || null;
  const scope = params.billingScope ?? "base_and_extra";
  let candidates = workBudgetItemsEligibleForInvoice(params.items, reg);
  candidates = filterItemsByBillingScope(candidates, scope, params.selectedItemIds);
  const billSlices = buildBillSlicesForInvoice(
    candidates,
    reg,
    params.partialNetByItemId
  );
  assertWorkBudgetInvoiceSelectionValid({ slices: billSlices, regenerateInvoiceId: reg });
  const billable = billSlices.map((s) => s.item);
  const normal = aggregateBillSlices(billSlices, isNormalBudgetItem);
  const extraWork = aggregateBillSlices(billSlices, isApprovedExtraWorkItem);
  const subtotalNet = roundMoney2(normal.net + extraWork.net);
  const subtotalVat = roundMoney2(normal.vat + extraWork.vat);
  const subtotalGross = roundMoney2(normal.gross + extraWork.gross);

  const advancesApplied: WorkBudgetInvoicePreview["advancesApplied"] = [];
  let deductionGross = 0;
  const idSet = new Set(params.selectedAdvanceIds.filter((id) => String(id).trim()));
  const seenAdvanceIds = new Set<string>();
  for (const adv of params.advances) {
    if (!idSet.has(adv.id)) continue;
    if (seenAdvanceIds.has(adv.id)) continue;
    seenAdvanceIds.add(adv.id);
    if (!isAdvanceEligibleForInvoiceDeduction(adv, reg)) {
      throw new Error(`Záloha „${adv.label}“ nelze započítat do faktury.`);
    }
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

  const rawDeduction = deductionGross;
  const after = applyAdvanceDeductionsToGross({
    subtotalNet,
    subtotalVat,
    subtotalGross,
    deductionGross,
  });
  const overpaymentGross =
    rawDeduction > subtotalGross ? roundMoney2(rawDeduction - subtotalGross) : 0;

  return {
    billableItems: billable,
    billSlices,
    billingScope: scope,
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
    ...(overpaymentGross > 0 ? { overpaymentGross } : {}),
  };
}

function resolveWorkBudgetSelectedAdvanceIds(params: {
  selectedAdvanceIds?: string[];
  regenerateInvoiceId?: string | null;
  existingAdvanceIds?: string[];
}): string[] {
  const explicit = (params.selectedAdvanceIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)];
  const reg = String(params.regenerateInvoiceId ?? "").trim();
  if (reg && params.existingAdvanceIds?.length) {
    return [...new Set(params.existingAdvanceIds.map((id) => String(id).trim()).filter(Boolean))];
  }
  return [];
}

export type WorkBudgetInvoiceStoredHeader = {
  issueDate: string;
  dueDate: string;
  taxSupplyDate: string;
  variableSymbol: string | null;
  overrideBankAccountId: string | null;
};

/** Hlavička z existující faktury — při regeneraci se nemění, pokud není explicitně přepsána. */
export function readWorkBudgetInvoiceHeaderFromDocument(
  inv: Record<string, unknown>
): WorkBudgetInvoiceStoredHeader {
  const issueDate =
    String(inv.issueDate ?? "").trim().slice(0, 10) ||
    new Date().toISOString().split("T")[0];
  const dueDate =
    String(inv.dueDate ?? "").trim().slice(0, 10) || defaultDueDateIso();
  const taxSupplyDate =
    String(inv.taxSupplyDate ?? issueDate).trim().slice(0, 10) || issueDate;
  const variableSymbol = String(inv.variableSymbol ?? "").trim() || null;
  const overrideBankAccountId = String(inv.bankAccountId ?? "").trim() || null;
  return {
    issueDate,
    dueDate,
    taxSupplyDate,
    variableSymbol,
    overrideBankAccountId,
  };
}

export function resolveWorkBudgetInvoiceNotesForDocument(
  inv: Record<string, unknown> | null | undefined,
  preview: WorkBudgetInvoicePreview
): string {
  if (inv?.workBudgetHeaderManual === true) {
    const manual = String(inv.notes ?? "").trim();
    if (manual) return manual;
  }
  return buildWorkBudgetInvoiceNotes(preview);
}

type WorkBudgetInvoiceBuildInput = {
  jobDisplayName: string;
  customerId: string;
  customer: unknown;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  preview: WorkBudgetInvoicePreview;
  /** Aktuální položky rozpočtu — zdroj typu (vícepráce) a názvů pro řádky faktury. */
  budgetCatalog: JobWorkBudgetItemDoc[];
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  taxSupplyDate: string;
  /** Při regeneraci — zachovat ruční hlavičku a odběratele z dokladu */
  existingInvoice?: Record<string, unknown> | null;
};

function buildWorkBudgetInvoiceNotes(
  preview: WorkBudgetInvoicePreview,
  jobDisplayName?: string
): string {
  let notes =
    preview.billingScope === "extra_only"
      ? `Vícepráce k zakázce${jobDisplayName ? `: ${jobDisplayName}` : ""}.`
      : "Faktura za provedené práce dle položkového rozpočtu zakázky.";
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
  const billSlices = input.preview.billSlices;
  const billable = input.preview.billableItems;
  const invoiceLines = buildInvoiceLinesFromBillSlices(billSlices, input.budgetCatalog);
  const advanceSettlement = buildWorkBudgetAdvanceSettlement({
    subtotalGross: input.preview.subtotalGross,
    deductionGross: input.preview.deductionGross,
    amountDueGross: input.preview.amountGross,
    amountDueNet: input.preview.amountNet,
    amountDueVat: input.preview.vatAmount,
    advancesApplied: input.preview.advancesApplied,
    overpaymentGross: input.preview.overpaymentGross,
    invoiceLines,
  });
  const storedHeader = input.existingInvoice
    ? readWorkBudgetInvoiceHeaderFromDocument(input.existingInvoice)
    : null;
  const issueDate = storedHeader?.issueDate ?? input.issueDate;
  const dueDate = storedHeader?.dueDate ?? input.dueDate;
  const taxSupplyDate = storedHeader?.taxSupplyDate ?? input.taxSupplyDate;
  const recipientFromDoc = input.existingInvoice
    ? parseInvoiceRecipientFromInvoiceDoc(input.existingInvoice)
    : null;
  const recipient =
    recipientFromDoc ??
    invoiceRecipientFromCustomerDoc(input.customerId, input.customer);
  const companyMeta = handoverCompanyPdfMeta(input.companyDoc);
  const c = input.companyDoc ?? {};
  const supplierIco = trim(c.ico ?? c.companyIco) || null;
  const supplierDic = trim(c.dic ?? c.companyDic) || null;
  const legacyCompanyBank = trim(c.bankAccount ?? c.companyBankAccount) || null;
  const notes = input.existingInvoice
    ? resolveWorkBudgetInvoiceNotesForDocument(input.existingInvoice, input.preview)
    : buildWorkBudgetInvoiceNotes(input.preview, input.jobDisplayName);
  const built = buildPortalManualInvoiceHtml({
    invoiceNumber: input.invoiceNumber,
    issueDate,
    dueDate,
    taxSupplyDate,
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
    advanceSettlement,
    overrideVariableSymbol: storedHeader?.variableSymbol ?? null,
    overrideBankAccountId: storedHeader?.overrideBankAccountId ?? null,
  });

  const { html, amountNet, vatAmount, amountGross, variableSymbol, vatBreakdown } = built;
  const preview = input.preview;
  let storedVatBreakdown = vatBreakdown;
  if (preview.deductionGross > 0 && storedVatBreakdown.length === 1) {
    const ratio = preview.subtotalGross > 0 ? preview.amountGross / preview.subtotalGross : 1;
    storedVatBreakdown = storedVatBreakdown.map((b) => ({
      rate: b.rate,
      base: roundMoney2(b.base * ratio),
      vat: roundMoney2(b.vat * ratio),
    }));
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
    vatBreakdown: storedVatBreakdown,
    notes,
    displayName: recipientDisplayName(recipient),
    addrLines: buildRecipientAddressMultiline(recipient),
    itemIds: billable.map((row) => row.id),
    advancesApplied: preview.advancesApplied,
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
  billSlices: WorkBudgetBillSlice[];
  previousAdvanceIds: string[];
  appliedAdvanceIds: string[];
}): void {
  const invoicedAt = new Date().toISOString();
  const newItemSet = new Set(params.billSlices.map((s) => s.item.id));
  const prevItemSet = new Set(params.previousItemIds);
  const newAdvSet = new Set(params.appliedAdvanceIds);
  const prevAdvSet = new Set(params.previousAdvanceIds);
  const batch = params.batch;
  const EPS = 0.009;

  for (const row of params.allItems) {
    if (!prevItemSet.has(row.id) || newItemSet.has(row.id)) continue;
    const hadLink =
      row.linkedInvoiceId === params.invoiceId ||
      (row.invoiceItemLinks ?? []).some((l) => l.invoiceId === params.invoiceId);
    if (!hadLink) continue;
    const links = removeInvoiceItemLink(row.invoiceItemLinks ?? [], params.invoiceId);
    const totals = sumInvoicedFromLinks(links);
    const fullyInvoiced = totals.gross >= row.amountGross - EPS;
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
        invoiceItemLinks: links,
        invoicedAmountNet: totals.net,
        invoicedAmountGross: totals.gross,
        invoiced: fullyInvoiced,
        invoicedAt: fullyInvoiced ? row.invoicedAt : null,
        linkedInvoiceId: links.length ? links[links.length - 1]!.invoiceId : null,
        updatedAt: serverTimestamp(),
      }
    );
  }

  for (const slice of params.billSlices) {
    const row = slice.item;
    const links = mergeInvoiceItemLink(row.invoiceItemLinks ?? [], params.invoiceId, {
      amountNet: slice.billNet,
      amountGross: slice.billGross,
      quantity: slice.billQuantity,
      invoicedAt,
    });
    const totals = sumInvoicedFromLinks(links);
    const fullyInvoiced = totals.gross >= row.amountGross - EPS;
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
        invoiceItemLinks: links,
        invoicedAmountNet: totals.net,
        invoicedAmountGross: totals.gross,
        invoiced: fullyInvoiced,
        invoicedAt: fullyInvoiced ? invoicedAt : row.invoicedAt ?? invoicedAt,
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
  billSlices: WorkBudgetBillSlice[];
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
  billingScope?: WorkBudgetBillingScope;
  selectedItemIds?: string[];
  partialNetByItemId?: Record<string, number>;
  userId: string;
  profileDisplayName?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string; amountGross: number }> {
  const budgetCatalog = params.items;
  const billingScope = params.billingScope ?? "base_and_extra";
  const selectedAdvanceIds =
    billingScope === "extra_only"
      ? []
      : resolveWorkBudgetSelectedAdvanceIds({
          selectedAdvanceIds: params.selectedAdvanceIds,
        });
  const preview = buildInvoiceFromBudgetAndAdvances({
    items: budgetCatalog,
    advances: params.advances ?? [],
    selectedAdvanceIds,
    billingScope,
    selectedItemIds: params.selectedItemIds,
    partialNetByItemId: params.partialNetByItemId,
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
    budgetCatalog,
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
    workBudgetBillingScope: billingScope,
    workBudgetItemIds: bundle.itemIds,
    workBudgetAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
    workBudgetAdvancesApplied: preview.advancesApplied.map((a) => ({
      advanceId: a.advanceId,
      label: a.label,
      amountGross: a.amountGross,
    })),
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
    allItems: budgetCatalog,
    previousItemIds: [],
    billSlices: preview.billSlices,
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

  const serverBudgetItems = await fetchJobWorkBudgetItemsFromFirestore(
    params.firestore,
    params.companyId,
    params.jobId
  );
  const budgetCatalog =
    serverBudgetItems.length > 0 ? serverBudgetItems : params.items;

  const previousAdvanceIds = Array.isArray(inv.workBudgetAdvanceIds)
    ? (inv.workBudgetAdvanceIds as string[])
    : [];
  const selectedAdvanceIds = resolveWorkBudgetSelectedAdvanceIds({
    selectedAdvanceIds: params.selectedAdvanceIds,
    regenerateInvoiceId: params.invoiceId,
    existingAdvanceIds: previousAdvanceIds,
  });
  const scopeRaw = String(inv.workBudgetBillingScope ?? "").trim();
  const billingScope: WorkBudgetBillingScope =
    scopeRaw === "base" ||
    scopeRaw === "extra_only" ||
    scopeRaw === "manual" ||
    scopeRaw === "base_and_extra"
      ? scopeRaw
      : "base_and_extra";
  const preview = buildInvoiceFromBudgetAndAdvances({
    items: budgetCatalog,
    advances: params.advances ?? [],
    selectedAdvanceIds,
    regenerateInvoiceId: params.invoiceId,
    billingScope,
  });
  if (preview.billableItems.length === 0) {
    throw new Error("Žádné položky k fakturaci podle aktuálního rozpočtu.");
  }

  const invoiceNumber = String(inv.invoiceNumber ?? "").trim();
  if (!invoiceNumber) {
    throw new Error("Faktura nemá číslo dokladu.");
  }
  const header = readWorkBudgetInvoiceHeaderFromDocument(inv);

  const bundle = buildWorkBudgetInvoiceHtmlBundle({
    jobDisplayName: params.jobDisplayName,
    customerId: params.customerId,
    customer: params.customer,
    companyDoc: params.companyDoc,
    orgBankAccounts: params.orgBankAccounts,
    preview,
    budgetCatalog,
    invoiceNumber,
    issueDate: header.issueDate,
    dueDate: header.dueDate,
    taxSupplyDate: header.taxSupplyDate,
    existingInvoice: inv,
  });

  const previousItemIds = Array.isArray(inv.workBudgetItemIds)
    ? (inv.workBudgetItemIds as string[])
    : [];
  const updatePayload = scrubFirestoreValue({
    items: portalFormItemsForFirestore(bundle.invoiceLines),
    totalAmount: bundle.amountGross,
    amountNet: bundle.amountNet,
    vatAmount: bundle.vatAmount,
    amountGross: bundle.amountGross,
    vatBreakdown: bundle.vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, vat: b.vat })),
    pdfHtml: bundle.html,
    notes: resolveWorkBudgetInvoiceNotesForDocument(inv, preview),
    workBudgetItemIds: bundle.itemIds,
    workBudgetAdvanceIds: preview.advancesApplied.map((a) => a.advanceId),
    workBudgetAdvancesApplied: preview.advancesApplied.map((a) => ({
      advanceId: a.advanceId,
      label: a.label,
      amountGross: a.amountGross,
    })),
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
    allItems: budgetCatalog,
    previousItemIds,
    billSlices: preview.billSlices,
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
    issueDate: header.issueDate,
    dueDate: header.dueDate,
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

export type WorkBudgetManualEditTotals = {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  subtotalGross: number;
  workBudgetItemIds: string[];
  vatBreakdown: Array<{ rate: number; base: number; vat: number }>;
};

/** Po ruční editaci řádků faktury — přepočet částek a sync invoiceItemLinks na rozpočtu. */
export async function syncWorkBudgetInvoiceAfterManualEdit(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
  invoiceLines: PortalManualFormItem[];
  inv: Record<string, unknown>;
}): Promise<WorkBudgetManualEditTotals> {
  const budgetItems = await fetchJobWorkBudgetItemsFromFirestore(
    params.firestore,
    params.companyId,
    params.jobId
  );
  const billSlices = buildBillSlicesFromManualInvoiceLines({
    budgetItems,
    invoiceId: params.invoiceId,
    lines: params.invoiceLines,
  });

  const lineTotals = computePortalManualInvoiceTotals(params.invoiceLines);
  const deductionGross = roundMoney2(Number(params.inv.workBudgetAdvanceDeductionGross) || 0);
  const after = applyAdvanceDeductionsToGross({
    subtotalGross: lineTotals.amountGross,
    subtotalNet: lineTotals.amountNet,
    subtotalVat: lineTotals.vatAmount,
    deductionGross,
  });

  let vatBreakdown = lineTotals.vatBreakdown.map((b) => ({
    rate: b.rate,
    base: b.base,
    vat: b.vat,
  }));
  if (after.deductionGross > 0 && vatBreakdown.length === 1 && lineTotals.amountGross > 0) {
    const ratio = after.gross / lineTotals.amountGross;
    vatBreakdown = vatBreakdown.map((b) => ({
      rate: b.rate,
      base: roundMoney2(b.base * ratio),
      vat: roundMoney2(b.vat * ratio),
    }));
  }

  const previousItemIds = Array.isArray(params.inv.workBudgetItemIds)
    ? (params.inv.workBudgetItemIds as string[])
    : [];
  const previousAdvanceIds = Array.isArray(params.inv.workBudgetAdvanceIds)
    ? (params.inv.workBudgetAdvanceIds as string[])
    : [];

  const batch = writeBatch(params.firestore);
  writeWorkBudgetInvoiceLinksToBatch({
    batch,
    firestore: params.firestore,
    companyId: params.companyId,
    jobId: params.jobId,
    invoiceId: params.invoiceId,
    allItems: budgetItems,
    previousItemIds,
    billSlices,
    previousAdvanceIds,
    appliedAdvanceIds: previousAdvanceIds,
  });
  await batch.commit();

  return {
    amountNet: after.net,
    vatAmount: after.vat,
    amountGross: after.gross,
    subtotalGross: lineTotals.amountGross,
    workBudgetItemIds: billSlices.map((s) => s.item.id),
    vatBreakdown,
  };
}
