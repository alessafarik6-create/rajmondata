import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import {
  buildPortalManualInvoiceHtml,
  buildRecipientAddressMultiline,
  parseInvoiceRecipientFromInvoiceDoc,
  parsePortalManualFormItemFromFirestore,
  portalFormItemsForFirestore,
  PORTAL_MANUAL_INVOICE_TYPE,
  recipientDisplayName,
  scrubFirestoreValue,
  computePortalManualInvoiceTotals,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { syncPortalInvoiceToDocuments } from "@/lib/portal-invoice-documents-sync";
import { applyAdvanceDeductionsToGross } from "@/lib/work-budget-financial-overview";
import {
  buildWorkBudgetAdvanceSettlement,
  parseWorkBudgetAdvancesAppliedFromInvoice,
} from "@/lib/work-budget-invoice-settlement";
import {
  isWorkBudgetSourceInvoice,
  readWorkBudgetInvoiceHeaderFromDocument,
  writeWorkBudgetInvoiceLinksToBatch,
} from "@/lib/work-budget-invoice";
import type { WorkBudgetBillSlice } from "@/lib/work-budget-invoicing";
import { removeInvoiceItemLink, sumInvoicedFromLinks } from "@/lib/work-budget-invoicing";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  isExtraWorkItem,
  isNormalBudgetItem,
  parseJobWorkBudgetItemFromFirestore,
  WORK_BUDGET_ITEMS_COLLECTION,
} from "@/lib/work-budget-types";
import type { JobWorkBudgetAdvanceDoc } from "@/lib/work-budget-advances";
import { roundMoney2 } from "@/lib/vat-calculations";

const EPS = 0.009;

export type WorkBudgetSplitLineBucket = "base" | "extra" | "ambiguous";

export type WorkBudgetSplitClassification = {
  baseLines: PortalManualFormItem[];
  extraLines: PortalManualFormItem[];
  ambiguousLines: PortalManualFormItem[];
};

export type WorkBudgetSplitPreview = {
  originalInvoiceNumber: string;
  originalGross: number;
  baseGross: number;
  extraGross: number;
  baseNet: number;
  extraNet: number;
  advanceDeductionGross: number;
  baseDueGross: number;
  classification: WorkBudgetSplitClassification;
};

export function parseInvoiceLinesFromDoc(inv: Record<string, unknown>): PortalManualFormItem[] {
  const raw = Array.isArray(inv.items) ? inv.items : [];
  return raw.map((row, idx) =>
    parsePortalManualFormItemFromFirestore(row as Record<string, unknown>, idx)
  );
}

export function classifyWorkBudgetInvoiceLines(params: {
  lines: PortalManualFormItem[];
  budgetCatalog: JobWorkBudgetItemDoc[];
  manualAssignments?: Record<string, WorkBudgetSplitLineBucket>;
}): WorkBudgetSplitClassification {
  const byId = new Map(params.budgetCatalog.map((row) => [row.id, row]));
  const baseLines: PortalManualFormItem[] = [];
  const extraLines: PortalManualFormItem[] = [];
  const ambiguousLines: PortalManualFormItem[] = [];

  for (const line of params.lines) {
    const manual = params.manualAssignments?.[line.id];
    if (manual === "base") {
      baseLines.push(line);
      continue;
    }
    if (manual === "extra") {
      extraLines.push(line);
      continue;
    }
    const budget = byId.get(line.id);
    if (!budget) {
      ambiguousLines.push(line);
      continue;
    }
    if (isNormalBudgetItem(budget)) {
      baseLines.push(line);
    } else if (isExtraWorkItem(budget)) {
      extraLines.push(line);
    } else {
      ambiguousLines.push(line);
    }
  }
  return { baseLines, extraLines, ambiguousLines };
}

export function canSplitWorkBudgetInvoice(inv: Record<string, unknown>): {
  allowed: boolean;
  reason?: string;
} {
  if (!isWorkBudgetSourceInvoice(inv)) {
    return { allowed: false, reason: "Faktura nevznikla z položkového rozpočtu." };
  }
  if (inv.isDeleted === true) {
    return { allowed: false, reason: "Smazanou fakturu nelze rozdělit." };
  }
  if (inv.workBudgetSplitSuperseded === true) {
    return { allowed: false, reason: "Tato faktura už byla nahrazena rozdělením." };
  }
  if (inv.workBudgetSplitBaseInvoiceId || inv.workBudgetSplitExtrasInvoiceId) {
    return { allowed: false, reason: "Faktura už byla rozdělena." };
  }
  const st = String(inv.status ?? "").trim().toLowerCase();
  if (st !== "draft") {
    return {
      allowed: false,
      reason:
        "Rozdělit lze pouze fakturu ve stavu koncept (draft). U vystavené nebo uhrazené faktury použijte storno a vystavte nové doklady.",
    };
  }
  const ps = String(inv.paymentStatus ?? "unpaid").trim().toLowerCase();
  if (ps === "paid" || ps === "partial") {
    return { allowed: false, reason: "Uhrazenou fakturu nelze rozdělit." };
  }
  return { allowed: true };
}

export function invoiceHasBaseAndExtraForSplit(
  inv: Record<string, unknown>,
  budgetCatalog: JobWorkBudgetItemDoc[],
  manualAssignments?: Record<string, WorkBudgetSplitLineBucket>
): boolean {
  const lines = parseInvoiceLinesFromDoc(inv).filter((l) => {
    const t = computePortalManualInvoiceTotals([l]);
    return t.amountGross > EPS && String(l.description ?? "").trim();
  });
  const c = classifyWorkBudgetInvoiceLines({
    lines,
    budgetCatalog,
    manualAssignments,
  });
  if (c.ambiguousLines.length > 0) return false;
  return c.baseLines.length > 0 && c.extraLines.length > 0;
}

export function buildWorkBudgetSplitPreview(params: {
  inv: Record<string, unknown>;
  budgetCatalog: JobWorkBudgetItemDoc[];
  manualAssignments?: Record<string, WorkBudgetSplitLineBucket>;
}): WorkBudgetSplitPreview {
  const lines = parseInvoiceLinesFromDoc(params.inv).filter((l) => {
    const t = computePortalManualInvoiceTotals([l]);
    return t.amountGross > EPS && String(l.description ?? "").trim();
  });
  const classification = classifyWorkBudgetInvoiceLines({
    lines,
    budgetCatalog: params.budgetCatalog,
    manualAssignments: params.manualAssignments,
  });
  if (classification.ambiguousLines.length > 0) {
    throw new Error("Některé položky nelze automaticky zařadit. Vyberte základ nebo vícepráce.");
  }
  if (classification.baseLines.length === 0 || classification.extraLines.length === 0) {
    throw new Error("Faktura neobsahuje zároveň základní práce i vícepráce.");
  }

  const baseTotals = computePortalManualInvoiceTotals(classification.baseLines);
  const extraTotals = computePortalManualInvoiceTotals(classification.extraLines);
  const advanceDeductionGross = roundMoney2(
    Number(params.inv.workBudgetAdvanceDeductionGross) || 0
  );
  const baseAfter = applyAdvanceDeductionsToGross({
    subtotalGross: baseTotals.amountGross,
    subtotalNet: baseTotals.amountNet,
    subtotalVat: baseTotals.vatAmount,
    deductionGross: advanceDeductionGross,
  });

  const originalGross = roundMoney2(Number(params.inv.amountGross) || 0);
  const combinedDue = roundMoney2(baseAfter.gross + extraTotals.amountGross);
  if (Math.abs(combinedDue - originalGross) > EPS) {
    throw new Error(
      `Součet po rozdělení (${combinedDue.toLocaleString("cs-CZ")} Kč) neodpovídá původní faktuře (${originalGross.toLocaleString("cs-CZ")} Kč).`
    );
  }
  const lineSumGross = roundMoney2(baseTotals.amountGross + extraTotals.amountGross);
  const originalSubtotal = roundMoney2(Number(params.inv.workBudgetSubtotalGross) || lineSumGross);
  if (Math.abs(lineSumGross - originalSubtotal) > EPS) {
    throw new Error("Součet položek neodpovídá mezisoučtu faktury.");
  }

  return {
    originalInvoiceNumber: String(params.inv.invoiceNumber ?? "—"),
    originalGross,
    baseGross: baseTotals.amountGross,
    extraGross: extraTotals.amountGross,
    baseNet: baseTotals.amountNet,
    extraNet: extraTotals.amountNet,
    advanceDeductionGross,
    baseDueGross: baseAfter.gross,
    classification,
  };
}

function billSliceFromLine(
  line: PortalManualFormItem,
  budgetItem: JobWorkBudgetItemDoc
): WorkBudgetBillSlice {
  const t = computePortalManualInvoiceTotals([line]);
  return {
    item: budgetItem,
    billNet: t.amountNet,
    billGross: t.amountGross,
    billQuantity: Math.max(0, Number(line.quantity) || 0),
  };
}

function buildSplitInvoiceHtml(params: {
  inv: Record<string, unknown>;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  jobDisplayName: string;
  invoiceNumber: string;
  lines: PortalManualFormItem[];
  notes: string;
  advanceDeductionGross: number;
  advancesApplied: ReturnType<typeof parseWorkBudgetAdvancesAppliedFromInvoice>;
}): {
  html: string;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  vatBreakdown: Array<{ rate: number; base: number; vat: number }>;
} {
  const header = readWorkBudgetInvoiceHeaderFromDocument(params.inv);
  const recipient =
    parseInvoiceRecipientFromInvoiceDoc(params.inv) ?? {
      type: "job_customer" as const,
      name: String(params.inv.customerName ?? "Odběratel"),
    };
  const companyMeta = handoverCompanyPdfMeta(params.companyDoc);
  const c = params.companyDoc ?? {};
  const lineTotals = computePortalManualInvoiceTotals(params.lines);
  let amountNet = lineTotals.amountNet;
  let vatAmount = lineTotals.vatAmount;
  let amountGross = lineTotals.amountGross;
  let vatBreakdown = lineTotals.vatBreakdown.map((b) => ({
    rate: b.rate,
    base: b.base,
    vat: b.vat,
  }));

  let advanceSettlement = null as ReturnType<typeof buildWorkBudgetAdvanceSettlement>;
  if (params.advanceDeductionGross > 0 && params.advancesApplied.length > 0) {
    const after = applyAdvanceDeductionsToGross({
      subtotalGross: lineTotals.amountGross,
      subtotalNet: lineTotals.amountNet,
      subtotalVat: lineTotals.vatAmount,
      deductionGross: params.advanceDeductionGross,
    });
    amountNet = after.net;
    vatAmount = after.vat;
    amountGross = after.gross;
    if (vatBreakdown.length === 1 && lineTotals.amountGross > 0) {
      const ratio = amountGross / lineTotals.amountGross;
      vatBreakdown = vatBreakdown.map((b) => ({
        rate: b.rate,
        base: roundMoney2(b.base * ratio),
        vat: roundMoney2(b.vat * ratio),
      }));
    }
    advanceSettlement = buildWorkBudgetAdvanceSettlement({
      subtotalGross: lineTotals.amountGross,
      deductionGross: after.deductionGross,
      amountDueGross: amountGross,
      amountDueNet: amountNet,
      amountDueVat: vatAmount,
      advancesApplied: params.advancesApplied,
      invoiceLines: params.lines,
    });
  }

  const built = buildPortalManualInvoiceHtml({
    invoiceNumber: params.invoiceNumber,
    issueDate: header.issueDate,
    dueDate: header.dueDate,
    taxSupplyDate: header.taxSupplyDate,
    jobName: params.jobDisplayName,
    notes: params.notes,
    recipient,
    supplierName: companyMeta.contractorCompanyName,
    supplierAddressLines: buildCompanyRegisteredAddress(c) ?? companyMeta.companyAddressText,
    supplierIco: String(c.ico ?? c.companyIco ?? "").trim() || null,
    supplierDic: String(c.dic ?? c.companyDic ?? "").trim() || null,
    logoUrl: companyMeta.logoUrl,
    items: params.lines,
    orgBankAccounts: params.orgBankAccounts,
    legacyCompanyBankLine: String(c.bankAccount ?? c.companyBankAccount ?? "").trim() || null,
    advanceSettlement,
    overrideVariableSymbol: header.variableSymbol,
    overrideBankAccountId: header.overrideBankAccountId,
  });

  return {
    html: built.html,
    amountNet,
    vatAmount,
    amountGross,
    vatBreakdown,
  };
}

function budgetCatalogWithoutOriginalInvoiceLinks(
  budgetCatalog: JobWorkBudgetItemDoc[],
  originalInvoiceId: string
): JobWorkBudgetItemDoc[] {
  return budgetCatalog.map((row) => {
    const links = removeInvoiceItemLink(row.invoiceItemLinks ?? [], originalInvoiceId);
    const totals = sumInvoicedFromLinks(links);
    const fullyInvoiced = totals.gross >= row.amountGross - EPS;
    return {
      ...row,
      invoiceItemLinks: links,
      invoicedAmountNet: totals.net,
      invoicedAmountGross: totals.gross,
      invoiced: fullyInvoiced,
      linkedInvoiceId: links.length ? links[links.length - 1]!.invoiceId : null,
    };
  });
}

export async function splitWorkBudgetCombinedInvoice(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
  jobDisplayName: string;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  budgetCatalog: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  splitOperationId: string;
  manualAssignments?: Record<string, WorkBudgetSplitLineBucket>;
  userId: string;
  profileDisplayName?: string;
}): Promise<{
  baseInvoiceId: string;
  extrasInvoiceId: string;
  baseInvoiceNumber: string;
  extrasInvoiceNumber: string;
}> {
  const opId = String(params.splitOperationId ?? "").trim();
  if (!opId) {
    throw new Error("Chybí identifikátor operace rozdělení.");
  }

  const originalRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );

  await runTransaction(params.firestore, async (tx) => {
    const snap = await tx.get(originalRef);
    if (!snap.exists()) throw new Error("Faktura neexistuje.");
    const data = snap.data() as Record<string, unknown>;
    if (String(data.jobId ?? "") !== params.jobId) {
      throw new Error("Faktura nepatří k této zakázce.");
    }
    const gate = canSplitWorkBudgetInvoice({ id: snap.id, ...data });
    if (!gate.allowed) throw new Error(gate.reason ?? "Nelze rozdělit.");
    if (
      data.workBudgetSplitOperationId === opId &&
      data.workBudgetSplitBaseInvoiceId &&
      data.workBudgetSplitExtrasInvoiceId
    ) {
      return;
    }
    if (data.workBudgetSplitInProgress === true) {
      throw new Error("Rozdělení faktury právě probíhá. Vyčkejte prosím.");
    }
    if (data.workBudgetSplitBaseInvoiceId) {
      throw new Error("Faktura už byla rozdělena.");
    }
    tx.update(originalRef, {
      workBudgetSplitInProgress: true,
      workBudgetSplitOperationId: opId,
      updatedAt: serverTimestamp(),
    });
  });

  try {
    const invSnap = await getDoc(originalRef);
    if (!invSnap.exists()) throw new Error("Faktura neexistuje.");
    const inv = { id: invSnap.id, ...invSnap.data() } as Record<string, unknown>;

    if (
      inv.workBudgetSplitOperationId === opId &&
      inv.workBudgetSplitBaseInvoiceId &&
      inv.workBudgetSplitExtrasInvoiceId
    ) {
      return {
        baseInvoiceId: String(inv.workBudgetSplitBaseInvoiceId),
        extrasInvoiceId: String(inv.workBudgetSplitExtrasInvoiceId),
        baseInvoiceNumber: String(inv.workBudgetSplitBaseInvoiceNumber ?? inv.invoiceNumber ?? ""),
        extrasInvoiceNumber: String(inv.workBudgetSplitExtrasInvoiceNumber ?? ""),
      };
    }

    const preview = buildWorkBudgetSplitPreview({
      inv,
      budgetCatalog: params.budgetCatalog,
      manualAssignments: params.manualAssignments,
    });

    const originalNumber = String(inv.invoiceNumber ?? "").trim();
    if (!originalNumber) throw new Error("Faktuře chybí číslo dokladu.");

    const extrasNumber = await allocateNextDocumentNumber(
      params.firestore,
      params.companyId,
      "FA"
    );

    const advancesApplied = parseWorkBudgetAdvancesAppliedFromInvoice(inv);
    const advanceIds = Array.isArray(inv.workBudgetAdvanceIds)
      ? (inv.workBudgetAdvanceIds as string[])
      : [];

    const baseBuilt = buildSplitInvoiceHtml({
      inv,
      companyDoc: params.companyDoc,
      orgBankAccounts: params.orgBankAccounts,
      jobDisplayName: params.jobDisplayName,
      invoiceNumber: originalNumber,
      lines: preview.classification.baseLines,
      notes: "Faktura za základní práce dle položkového rozpočtu zakázky.",
      advanceDeductionGross: preview.advanceDeductionGross,
      advancesApplied,
    });

    const extraBuilt = buildSplitInvoiceHtml({
      inv,
      companyDoc: params.companyDoc,
      orgBankAccounts: params.orgBankAccounts,
      jobDisplayName: params.jobDisplayName,
      invoiceNumber: extrasNumber,
      lines: preview.classification.extraLines,
      notes: `Vícepráce k zakázce: ${params.jobDisplayName}.`,
      advanceDeductionGross: 0,
      advancesApplied: [],
    });

    const byId = new Map(params.budgetCatalog.map((r) => [r.id, r]));
    const baseSlices: WorkBudgetBillSlice[] = [];
    const extraSlices: WorkBudgetBillSlice[] = [];
    for (const line of preview.classification.baseLines) {
      const b = byId.get(line.id);
      if (b) baseSlices.push(billSliceFromLine(line, b));
    }
    for (const line of preview.classification.extraLines) {
      const b = byId.get(line.id);
      if (b) extraSlices.push(billSliceFromLine(line, b));
    }

    const previousItemIds = Array.isArray(inv.workBudgetItemIds)
      ? (inv.workBudgetItemIds as string[])
      : [...baseSlices, ...extraSlices].map((s) => s.item.id);

    const batch = writeBatch(params.firestore);
    const invoicesCol = collection(params.firestore, "companies", params.companyId, "invoices");
    const baseRef = doc(invoicesCol);
    const extrasRef = doc(invoicesCol);

    const commonHeader = {
      type: PORTAL_MANUAL_INVOICE_TYPE,
      organizationId: params.companyId,
      companyId: params.companyId,
      jobId: params.jobId,
      customerId: inv.customerId ?? null,
      invoiceRecipient: inv.invoiceRecipient ?? null,
      customerName: inv.customerName ?? null,
      customerAddressLines: inv.customerAddressLines ?? null,
      customerPhone: inv.customerPhone ?? null,
      customerEmail: inv.customerEmail ?? null,
      customerIco: inv.customerIco ?? null,
      customerDic: inv.customerDic ?? null,
      paymentStatus: "unpaid",
      requiresPayment: true,
      status: "draft",
      issueStatus: "issued",
      isDeleted: false,
      workBudgetSource: true,
      workBudgetLinesPristine: true,
      workBudgetSplitFromInvoiceId: params.invoiceId,
      workBudgetSplitOperationId: opId,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
      updatedAt: serverTimestamp(),
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      taxSupplyDate: inv.taxSupplyDate,
      variableSymbol: inv.variableSymbol ?? null,
      bankAccountId: inv.bankAccountId ?? null,
      bankAccountNumber: inv.bankAccountNumber ?? null,
      bankCode: inv.bankCode ?? null,
      iban: inv.iban ?? null,
      swift: inv.swift ?? null,
    };

    batch.set(
      baseRef,
      scrubFirestoreValue({
        ...commonHeader,
        invoiceNumber: originalNumber,
        workBudgetSplitRole: "base",
        workBudgetBillingScope: "base",
        items: portalFormItemsForFirestore(preview.classification.baseLines),
        pdfHtml: baseBuilt.html,
        amountNet: baseBuilt.amountNet,
        vatAmount: baseBuilt.vatAmount,
        amountGross: baseBuilt.amountGross,
        totalAmount: baseBuilt.amountGross,
        vatBreakdown: baseBuilt.vatBreakdown,
        workBudgetSubtotalGross: preview.baseGross,
        workBudgetAdvanceDeductionGross: preview.advanceDeductionGross,
        workBudgetAdvanceIds: advanceIds,
        workBudgetAdvancesApplied: inv.workBudgetAdvancesApplied ?? [],
        workBudgetItemIds: baseSlices.map((s) => s.item.id),
        notes: "Faktura za základní práce dle položkového rozpočtu zakázky.",
      }) as Record<string, unknown>
    );

    batch.set(
      extrasRef,
      scrubFirestoreValue({
        ...commonHeader,
        invoiceNumber: extrasNumber,
        workBudgetSplitRole: "extra",
        workBudgetBillingScope: "extra_only",
        items: portalFormItemsForFirestore(preview.classification.extraLines),
        pdfHtml: extraBuilt.html,
        amountNet: extraBuilt.amountNet,
        vatAmount: extraBuilt.vatAmount,
        amountGross: extraBuilt.amountGross,
        totalAmount: extraBuilt.amountGross,
        vatBreakdown: extraBuilt.vatBreakdown,
        workBudgetSubtotalGross: preview.extraGross,
        workBudgetAdvanceDeductionGross: 0,
        workBudgetAdvanceIds: [],
        workBudgetAdvancesApplied: [],
        workBudgetItemIds: extraSlices.map((s) => s.item.id),
        notes: `Vícepráce k zakázce: ${params.jobDisplayName}.`,
      }) as Record<string, unknown>
    );

    const catalogForLinks = budgetCatalogWithoutOriginalInvoiceLinks(
      params.budgetCatalog,
      params.invoiceId
    );

    writeWorkBudgetInvoiceLinksToBatch({
      batch,
      firestore: params.firestore,
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: baseRef.id,
      allItems: catalogForLinks,
      previousItemIds: [],
      billSlices: baseSlices,
      previousAdvanceIds: advanceIds,
      appliedAdvanceIds: advanceIds,
    });

    writeWorkBudgetInvoiceLinksToBatch({
      batch,
      firestore: params.firestore,
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: extrasRef.id,
      allItems: catalogForLinks,
      previousItemIds: [],
      billSlices: extraSlices,
      previousAdvanceIds: [],
      appliedAdvanceIds: [],
    });

    batch.update(originalRef, {
      workBudgetSplitSuperseded: true,
      status: "superseded",
      workBudgetSplitInProgress: false,
      workBudgetSplitAt: new Date().toISOString(),
      workBudgetSplitBy: params.userId,
      workBudgetSplitBaseInvoiceId: baseRef.id,
      workBudgetSplitExtrasInvoiceId: extrasRef.id,
      workBudgetSplitBaseInvoiceNumber: originalNumber,
      workBudgetSplitExtrasInvoiceNumber: extrasNumber,
      workBudgetSplitOriginalGross: preview.originalGross,
      requiresPayment: false,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    const displayName = String(inv.customerName ?? "").trim() || "Odběratel";
    const linkedOriginal =
      typeof inv.linkedDocumentId === "string" ? inv.linkedDocumentId : null;

    await syncPortalInvoiceToDocuments({
      firestore: params.firestore,
      companyId: params.companyId,
      invoiceId: baseRef.id,
      userId: params.userId,
      uploadedByName: params.profileDisplayName ?? "Uživatel",
      invoiceNumber: originalNumber,
      customerName: displayName,
      jobId: params.jobId,
      jobName: params.jobDisplayName,
      issueDate: String(inv.issueDate ?? ""),
      dueDate: String(inv.dueDate ?? ""),
      amountNet: baseBuilt.amountNet,
      vatAmount: baseBuilt.vatAmount,
      amountGross: baseBuilt.amountGross,
      linkedDocumentId: null,
    });

    await syncPortalInvoiceToDocuments({
      firestore: params.firestore,
      companyId: params.companyId,
      invoiceId: extrasRef.id,
      userId: params.userId,
      uploadedByName: params.profileDisplayName ?? "Uživatel",
      invoiceNumber: extrasNumber,
      customerName: displayName,
      jobId: params.jobId,
      jobName: params.jobDisplayName,
      issueDate: String(inv.issueDate ?? ""),
      dueDate: String(inv.dueDate ?? ""),
      amountNet: extraBuilt.amountNet,
      vatAmount: extraBuilt.vatAmount,
      amountGross: extraBuilt.amountGross,
      linkedDocumentId: null,
    });

    if (linkedOriginal) {
      await syncPortalInvoiceToDocuments({
        firestore: params.firestore,
        companyId: params.companyId,
        invoiceId: params.invoiceId,
        userId: params.userId,
        uploadedByName: params.profileDisplayName ?? "Uživatel",
        invoiceNumber: originalNumber,
        customerName: displayName,
        jobId: params.jobId,
        jobName: params.jobDisplayName,
        issueDate: String(inv.issueDate ?? ""),
        dueDate: String(inv.dueDate ?? ""),
        amountNet: 0,
        vatAmount: 0,
        amountGross: 0,
        linkedDocumentId: linkedOriginal,
      });
    }

    return {
      baseInvoiceId: baseRef.id,
      extrasInvoiceId: extrasRef.id,
      baseInvoiceNumber: originalNumber,
      extrasInvoiceNumber: extrasNumber,
    };
  } catch (e) {
    await runTransaction(params.firestore, async (tx) => {
      const snap = await tx.get(originalRef);
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      if (data.workBudgetSplitOperationId !== opId) return;
      if (data.workBudgetSplitBaseInvoiceId) return;
      tx.update(originalRef, {
        workBudgetSplitInProgress: false,
        updatedAt: serverTimestamp(),
      });
    });
    throw e;
  }
}

export async function loadJobWorkBudgetItemsForSplit(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<JobWorkBudgetItemDoc[]> {
  const itemsSnap = await getDocs(
    collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION)
  );
  return itemsSnap.docs.map((d) =>
    parseJobWorkBudgetItemFromFirestore(d.data() as Record<string, unknown>, d.id)
  );
}
