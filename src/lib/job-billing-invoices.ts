/**
 * Zálohové faktury a daňové doklady k přijaté platbě — vazba na smlouvu o dílo a zakázku.
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  computeExpenseAmountsFromInput,
  normalizeVatRate,
  roundMoney2,
  type JobBudgetBreakdown,
  type VatRatePercent,
} from "@/lib/vat-calculations";
import { computeDepositAmountKc } from "@/lib/work-contract-deposit";
import type { JobBudgetType } from "@/lib/vat-calculations";
import {
  buildAdvanceInvoiceHtml,
  buildFinalSettlementInvoiceHtml,
  buildTaxReceiptHtml,
  singleLineFromGross,
  type InvoiceLineRow,
  type SettlementAdvanceRow,
} from "@/lib/invoice-a4-html";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import {
  type OrgBankAccountRow,
  formatBankBlockPlainLines,
  formatCustomerPartyLines,
  formatSupplierPartyLines,
  resolveBankAccountForInvoice,
  resolveInvoiceRecipient,
  resolveInvoiceVariableSymbol,
} from "@/lib/invoice-billing-meta";

export type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";

export const JOB_INVOICE_TYPES = {
  ADVANCE: "advance_invoice",
  TAX_RECEIPT: "tax_receipt_received_payment",
  FINAL_INVOICE: "final_invoice",
} as const;

export const INVOICE_SUBTYPE_SETTLEMENT = "settlement_invoice" as const;

export type JobInvoiceType =
  (typeof JOB_INVOICE_TYPES)[keyof typeof JOB_INVOICE_TYPES];

export type WorkContractLike = {
  id: string;
  contractNumber?: string | null;
  /** Odběratel dle smlouvy o dílo */
  contractor?: string | null;
  bankAccountId?: string | null;
  bankAccountNumber?: string | null;
  depositAmount?: string | number | null;
  depositPercentage?: string | number | null;
  zalohovaCastka?: string | number | null;
  zalohovaProcenta?: string | number | null;
};

function numStr(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/** Částka zálohy v Kč (stejná logika jako ve smlouvě) — rozpočet = hrubý rozpočet zakázky. */
export function depositGrossKcFromContract(
  contract: WorkContractLike,
  budgetGross: number | null
): number {
  const amt = numStr(contract.depositAmount ?? contract.zalohovaCastka);
  const pct = numStr(contract.depositPercentage ?? contract.zalohovaProcenta);
  return computeDepositAmountKc({
    depositAmountStr: amt,
    depositPercentStr: pct,
    budgetKc: budgetGross,
  });
}

export function hasAdvanceTerms(
  contract: WorkContractLike,
  budgetGross: number | null
): boolean {
  const kc = depositGrossKcFromContract(contract, budgetGross);
  return kc > 0;
}

function splitGrossToNetVat(
  amountGross: number,
  vatRate: VatRatePercent
): { amountNet: number; vatAmount: number; amountGross: number } {
  return computeExpenseAmountsFromInput({
    amountInput: roundMoney2(amountGross),
    amountType: "gross",
    vatRate,
  });
}

export function variableSymbolFromInvoiceNumber(invoiceNumber: string): string {
  const d = invoiceNumber.replace(/\D/g, "");
  if (d.length >= 4) return d.slice(0, 10);
  return invoiceNumber.replace(/\s/g, "").slice(0, 20) || invoiceNumber;
}

export type ManualAdvanceLineInput = {
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  vatRate: VatRatePercent;
};

export function computeManualAdvanceTotals(lines: ManualAdvanceLineInput[]): {
  rows: InvoiceLineRow[];
  amountNet: number;
  vatAmount: number;
  amountGross: number;
} {
  const rows: InvoiceLineRow[] = [];
  let amountNet = 0;
  let vatAmount = 0;
  let amountGross = 0;
  for (const L of lines) {
    const q = Math.max(0, roundMoney2(L.quantity));
    const lineNet = roundMoney2(q * roundMoney2(L.unitPriceNet));
    const vat = roundMoney2((lineNet * L.vatRate) / 100);
    const gross = roundMoney2(lineNet + vat);
    rows.push({
      description: L.description.trim() || "Položka",
      quantity: q,
      unit: (L.unit || "ks").trim() || "ks",
      unitPriceNet: roundMoney2(L.unitPriceNet),
      vatRate: L.vatRate,
      lineNet,
      lineVat: vat,
      lineGross: gross,
    });
    amountNet += lineNet;
    vatAmount += vat;
    amountGross += gross;
  }
  return {
    rows,
    amountNet: roundMoney2(amountNet),
    vatAmount: roundMoney2(vatAmount),
    amountGross: roundMoney2(amountGross),
  };
}

/** Položky z uloženého dokladu → vstup pro úpravu (kompatibilní se starým `unitPrice`). */
export function invoiceItemsToManualLines(inv: Record<string, unknown>): ManualAdvanceLineInput[] {
  const items = inv.items;
  if (!Array.isArray(items) || items.length === 0) {
    return [
      {
        description: "",
        quantity: 1,
        unit: "ks",
        unitPriceNet: 0,
        vatRate: 21,
      },
    ];
  }
  return items.map((raw) => {
    const it = raw as Record<string, unknown>;
    const up =
      typeof it.unitPriceNet === "number"
        ? it.unitPriceNet
        : typeof it.unitPrice === "number"
          ? it.unitPrice
          : Number(it.unitPriceNet ?? it.unitPrice) || 0;
    return {
      description: String(it.description ?? "").trim() || "Položka",
      quantity: Math.max(0, Number(it.quantity) || 0),
      unit: String(it.unit ?? "ks").trim() || "ks",
      unitPriceNet: roundMoney2(up),
      vatRate: normalizeVatRate(Number(it.vatRate) || 21),
    };
  });
}

function itemsRowsForFirestore(rows: InvoiceLineRow[]) {
  return rows.map((r) => ({
    description: r.description,
    quantity: r.quantity,
    unit: r.unit,
    unitPriceNet: r.unitPriceNet,
    vatRate: r.vatRate,
    lineNet: r.lineNet,
    lineVat: r.lineVat,
    lineGross: r.lineGross,
  }));
}

function representativeVatRate(rows: InvoiceLineRow[]): VatRatePercent {
  if (rows.length === 0) return 21;
  const first = rows[0].vatRate;
  const allSame = rows.every((r) => r.vatRate === first);
  return allSame ? normalizeVatRate(first) : 21;
}

export async function findExistingAdvanceForContract(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  sourceContractId: string
): Promise<boolean> {
  const q = query(
    collection(firestore, "companies", companyId, "invoices"),
    where("jobId", "==", jobId),
    limit(80)
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const x = d.data() as { type?: string; sourceContractId?: string };
    if (
      x.type === JOB_INVOICE_TYPES.ADVANCE &&
      x.sourceContractId === sourceContractId
    ) {
      return true;
    }
  }
  return false;
}

export async function sumTaxReceiptsPaidGrossForAdvance(
  firestore: Firestore,
  companyId: string,
  relatedInvoiceId: string
): Promise<number> {
  const q = query(
    collection(firestore, "companies", companyId, "invoices"),
    where("relatedInvoiceId", "==", relatedInvoiceId),
    limit(50)
  );
  const snap = await getDocs(q);
  let s = 0;
  for (const d of snap.docs) {
    const x = d.data() as {
      type?: string;
      amountGross?: unknown;
    };
    if (x.type !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    s += Number(x.amountGross) || 0;
  }
  return roundMoney2(s);
}

export async function createAdvanceInvoiceFromContract(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  customerId: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  contract: WorkContractLike;
  budget: JobBudgetBreakdown;
  userId: string;
  logoUrl?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  legacyCompanyBankAccount?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  overrideBankAccountId?: string | null;
  taxSupplyDate?: string | null;
}): Promise<{ invoiceId: string; invoiceNumber: string; pdfHtml: string }> {
  const gross = depositGrossKcFromContract(
    params.contract,
    params.budget.budgetGross
  );
  if (gross <= 0) {
    throw new Error("Nelze vystavit zálohovou fakturu — chybí částka zálohy ve smlouvě.");
  }

  const vatRate = normalizeVatRate(params.budget.vatRate);
  const { amountNet, vatAmount, amountGross } = splitGrossToNetVat(gross, vatRate);

  const dup = await findExistingAdvanceForContract(
    params.firestore,
    params.companyId,
    params.jobId,
    params.contract.id
  );
  if (dup) {
    throw new Error("Pro tuto smlouvu již existuje zálohová faktura.");
  }

  const issueDate = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const dueDate = due.toISOString().slice(0, 10);
  const taxSupplyDate =
    (params.taxSupplyDate && params.taxSupplyDate.trim()) || issueDate;

  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "ZF"
  );
  const vs = resolveInvoiceVariableSymbol({
    contractNumber: params.contract.contractNumber,
    invoiceNumber,
  });

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: params.contract.bankAccountId,
    contractBankAccountNumber: params.contract.bankAccountNumber,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId: params.overrideBankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const recipient = resolveInvoiceRecipient({
    contractContractor: params.contract.contractor,
    fallbackCustomerName: params.customerName,
    customerAddressLines: params.customerAddressLines,
    customerIco: params.customerIco,
    customerDic: params.customerDic,
  });
  const customerParty = formatCustomerPartyLines(
    recipient.customerName,
    recipient.customerAddressLines,
    recipient.customerIco,
    recipient.customerDic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: params.supplierIco,
    dic: params.supplierDic,
  });

  const lineRow = singleLineFromGross({
    description: `Záloha dle smlouvy o dílo — zakázka ${params.jobName}`,
    amountNet,
    vatRate,
    vatAmount,
    amountGross,
  });

  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: recipient.customerName,
    customerAddressText: customerParty,
    invoiceNumber,
    issueDate,
    taxSupplyDate,
    dueDate,
    jobName: params.jobName,
    contractNumber: params.contract.contractNumber != null ? String(params.contract.contractNumber) : null,
    variableSymbol: vs,
    bankAccountText: bankText,
    items: [lineRow],
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: `${vatRate}`,
  });

  const invRef = doc(collection(params.firestore, "companies", params.companyId, "invoices"));
  const billingMirrorRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "billingDocuments",
    invRef.id
  );

  await runTransaction(params.firestore, async (tx) => {
    tx.set(invRef, {
      type: JOB_INVOICE_TYPES.ADVANCE,
      organizationId: params.companyId,
      companyId: params.companyId,
      jobId: params.jobId,
      customerId: params.customerId,
      customerName: recipient.customerName,
      amountNet,
      vatAmount,
      amountGross,
      vatRate,
      amountType: "gross" as JobBudgetType,
      invoiceNumber,
      issueDate,
      taxSupplyDate,
      dueDate,
      source: "contract",
      sourceContractId: params.contract.id,
      contractNumber:
        params.contract.contractNumber != null
          ? String(params.contract.contractNumber)
          : null,
      variableSymbol: vs,
      bankAccountId: bankSnap.bankAccountId,
      bankAccountNumber: bankSnap.bankAccountNumber,
      bankCode: bankSnap.bankCode,
      iban: bankSnap.iban,
      swift: bankSnap.swift,
      supplierIco: params.supplierIco ?? null,
      supplierDic: params.supplierDic ?? null,
      customerIco: recipient.customerIco,
      customerDic: recipient.customerDic,
      /** Stav úhrady zálohové faktury */
      status: "unpaid",
      /** Dokument je vystavený (ne koncept) */
      issueStatus: "issued",
      paidGrossReceived: 0,
      pdfHtml: html,
      items: itemsRowsForFirestore([lineRow]),
      totalAmount: amountGross,
      notes: "",
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });

    tx.set(billingMirrorRef, {
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: invRef.id,
      kind: JOB_INVOICE_TYPES.ADVANCE,
      invoiceNumber,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });
  });

  return { invoiceId: invRef.id, invoiceNumber, pdfHtml: html };
}

export async function createManualAdvanceInvoice(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  customerId: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  userId: string;
  logoUrl?: string | null;
  lines: ManualAdvanceLineInput[];
  /** Pro VS a banku — první smlouva u zakázky, pokud existuje */
  primaryWorkContract?: WorkContractLike | null;
  orgBankAccounts?: OrgBankAccountRow[];
  legacyCompanyBankAccount?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  overrideBankAccountId?: string | null;
  taxSupplyDate?: string | null;
}): Promise<{ invoiceId: string; invoiceNumber: string; pdfHtml: string }> {
  const { rows, amountNet, vatAmount, amountGross } = computeManualAdvanceTotals(
    params.lines
  );
  if (rows.length === 0 || amountGross <= 0) {
    throw new Error("Přidejte alespoň jednu položku s kladnou částkou s DPH.");
  }
  const vatRateDoc = representativeVatRate(rows);

  const issueDate = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const dueDate = due.toISOString().slice(0, 10);
  const taxSupplyDate =
    (params.taxSupplyDate && params.taxSupplyDate.trim()) || issueDate;

  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "ZF"
  );
  const c = params.primaryWorkContract ?? null;
  const vs = resolveInvoiceVariableSymbol({
    contractNumber: c?.contractNumber,
    invoiceNumber,
  });
  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: c?.bankAccountId,
    contractBankAccountNumber: c?.bankAccountNumber,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId: params.overrideBankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const recipient = resolveInvoiceRecipient({
    contractContractor: c?.contractor,
    fallbackCustomerName: params.customerName,
    customerAddressLines: params.customerAddressLines,
    customerIco: params.customerIco,
    customerDic: params.customerDic,
  });
  const customerParty = formatCustomerPartyLines(
    recipient.customerName,
    recipient.customerAddressLines,
    recipient.customerIco,
    recipient.customerDic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: params.supplierIco,
    dic: params.supplierDic,
  });

  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);

  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: recipient.customerName,
    customerAddressText: customerParty,
    invoiceNumber,
    issueDate,
    taxSupplyDate,
    dueDate,
    jobName: params.jobName,
    contractNumber: c?.contractNumber != null ? String(c.contractNumber) : null,
    variableSymbol: vs,
    bankAccountText: bankText,
    items: rows,
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
    note: "Vlastní zálohová faktura.",
  });

  const invRef = doc(collection(params.firestore, "companies", params.companyId, "invoices"));
  const billingMirrorRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "billingDocuments",
    invRef.id
  );

  await runTransaction(params.firestore, async (tx) => {
    tx.set(invRef, {
      type: JOB_INVOICE_TYPES.ADVANCE,
      organizationId: params.companyId,
      companyId: params.companyId,
      jobId: params.jobId,
      customerId: params.customerId,
      customerName: recipient.customerName,
      amountNet,
      vatAmount,
      amountGross,
      vatRate: vatRateDoc,
      amountType: "gross" as JobBudgetType,
      invoiceNumber,
      issueDate,
      taxSupplyDate,
      dueDate,
      source: "manual",
      variableSymbol: vs,
      status: "unpaid",
      issueStatus: "issued",
      paidGrossReceived: 0,
      pdfHtml: html,
      items: itemsRowsForFirestore(rows),
      totalAmount: amountGross,
      notes: "",
      createdAt: serverTimestamp(),
      createdBy: params.userId,
      bankAccountId: bankSnap.bankAccountId,
      bankAccountNumber: bankSnap.bankAccountNumber,
      bankCode: bankSnap.bankCode,
      iban: bankSnap.iban,
      swift: bankSnap.swift,
      supplierIco: params.supplierIco ?? null,
      supplierDic: params.supplierDic ?? null,
      customerIco: recipient.customerIco,
      customerDic: recipient.customerDic,
      contractNumber:
        c?.contractNumber != null ? String(c.contractNumber) : null,
    });

    tx.set(billingMirrorRef, {
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: invRef.id,
      kind: JOB_INVOICE_TYPES.ADVANCE,
      invoiceNumber,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });
  });

  return { invoiceId: invRef.id, invoiceNumber, pdfHtml: html };
}

export async function updateAdvanceInvoiceItems(params: {
  firestore: Firestore;
  companyId: string;
  invoiceId: string;
  jobName: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  userId: string;
  logoUrl?: string | null;
  lines: ManualAdvanceLineInput[];
  issueDate?: string;
  dueDate?: string;
  taxSupplyDate?: string;
  variableSymbol?: string;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  bankAccountId?: string | null;
  legacyCompanyBankAccount?: string | null;
}): Promise<{ pdfHtml: string }> {
  const { rows, amountNet, vatAmount, amountGross } = computeManualAdvanceTotals(
    params.lines
  );
  if (rows.length === 0 || amountGross <= 0) {
    throw new Error("Přidejte alespoň jednu položku s kladnou částkou s DPH.");
  }
  const vatRateDoc = representativeVatRate(rows);
  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );
  const snap = await getDoc(invRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const inv = snap.data() as {
    type?: string;
    invoiceNumber?: string;
    issueDate?: string;
    dueDate?: string;
    taxSupplyDate?: string;
    variableSymbol?: string;
    sourceContractId?: string;
    contractNumber?: string | null;
    bankAccountId?: string | null;
    supplierIco?: string | null;
    supplierDic?: string | null;
    customerIco?: string | null;
    customerDic?: string | null;
  };
  if (inv.type !== JOB_INVOICE_TYPES.ADVANCE) {
    throw new Error("Upravit lze jen zálohovou fakturu.");
  }
  const invoiceNumber = String(inv.invoiceNumber ?? "");
  const issueDate = String(
    params.issueDate ?? inv.issueDate ?? new Date().toISOString().slice(0, 10)
  );
  const dueDate = String(params.dueDate ?? inv.dueDate ?? issueDate);
  const taxSupplyDate = String(
    params.taxSupplyDate ?? inv.taxSupplyDate ?? issueDate
  );
  const vsRaw =
    params.variableSymbol != null && String(params.variableSymbol).trim()
      ? String(params.variableSymbol).trim()
      : inv.variableSymbol && String(inv.variableSymbol).trim()
        ? String(inv.variableSymbol).trim()
        : variableSymbolFromInvoiceNumber(invoiceNumber);
  const vs = vsRaw;
  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);

  const supIco = params.supplierIco ?? inv.supplierIco ?? null;
  const supDic = params.supplierDic ?? inv.supplierDic ?? null;
  const custIco = params.customerIco ?? inv.customerIco ?? null;
  const custDic = params.customerDic ?? inv.customerDic ?? null;

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: null,
    contractBankAccountNumber: null,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId:
      params.bankAccountId !== undefined ? params.bankAccountId : inv.bankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: supIco,
    dic: supDic,
  });
  const customerParty = formatCustomerPartyLines(
    params.customerName,
    params.customerAddressLines,
    custIco,
    custDic
  );

  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: params.customerName,
    customerAddressText: customerParty,
    invoiceNumber,
    issueDate,
    taxSupplyDate,
    dueDate,
    jobName: params.jobName,
    contractNumber:
      inv.contractNumber != null && String(inv.contractNumber).trim()
        ? String(inv.contractNumber).trim()
        : null,
    variableSymbol: vs,
    bankAccountText: bankText,
    items: rows,
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
    note: "Doklad slouží jako zálohová faktura dle smlouvy o dílo.",
  });

  await updateDoc(invRef, {
    amountNet,
    vatAmount,
    amountGross,
    vatRate: vatRateDoc,
    totalAmount: amountGross,
    pdfHtml: html,
    items: itemsRowsForFirestore(rows),
    variableSymbol: vs,
    issueDate,
    dueDate,
    taxSupplyDate,
    customerName: params.customerName,
    supplierIco: supIco,
    supplierDic: supDic,
    customerIco: custIco,
    customerDic: custDic,
    bankAccountId: bankSnap.bankAccountId,
    bankAccountNumber: bankSnap.bankAccountNumber,
    bankCode: bankSnap.bankCode,
    iban: bankSnap.iban,
    swift: bankSnap.swift,
    updatedAt: serverTimestamp(),
    updatedBy: params.userId,
  });

  return { pdfHtml: html };
}

export async function createTaxReceiptForAdvancePayment(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  jobDisplayName: string;
  customerId: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  advanceInvoiceId: string;
  advanceInvoiceNumber: string;
  advanceAmountGross: number;
  /** Uhrazená částka s DPH (≤ zbývá na záloze). */
  paidGrossInput: number;
  paymentDate: string;
  variableSymbol?: string;
  note?: string;
  vatRate: VatRatePercent;
  userId: string;
  logoUrl?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  legacyCompanyBankAccount?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  overrideBankAccountId?: string | null;
  /** Datum vystavení daňového dokladu — výchozí datum platby */
  issueDate?: string | null;
  /** Zdanitelné plnění — výchozí datum platby */
  taxSupplyDate?: string | null;
}): Promise<{ receiptId: string; documentNumber: string; pdfHtml: string }> {
  const paidGross = roundMoney2(params.paidGrossInput);
  if (paidGross <= 0) throw new Error("Zadejte kladnou uhrazenou částku.");

  const already = await sumTaxReceiptsPaidGrossForAdvance(
    params.firestore,
    params.companyId,
    params.advanceInvoiceId
  );
  const remaining = roundMoney2(params.advanceAmountGross - already);
  if (paidGross > remaining + 0.01) {
    throw new Error(
      `Částka přesahuje zbývající zálohu (${remaining.toLocaleString("cs-CZ")} Kč s DPH).`
    );
  }

  const { amountNet, vatAmount, amountGross } = splitGrossToNetVat(
    paidGross,
    params.vatRate
  );

  const advanceRefPre = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.advanceInvoiceId
  );
  const advanceSnapPre = await getDoc(advanceRefPre);
  const advPre = advanceSnapPre.exists()
    ? (advanceSnapPre.data() as {
        contractNumber?: string | null;
        bankAccountId?: string | null;
      })
    : {};

  const documentNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "DD"
  );
  const vsResolved = resolveInvoiceVariableSymbol({
    contractNumber: advPre.contractNumber,
    invoiceNumber: documentNumber,
  });
  const vs =
    (params.variableSymbol && params.variableSymbol.trim()) || vsResolved;

  const issueDate =
    (params.issueDate && params.issueDate.trim()) || params.paymentDate;
  const taxSupplyDate =
    (params.taxSupplyDate && params.taxSupplyDate.trim()) || params.paymentDate;

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: null,
    contractBankAccountNumber: null,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId:
      params.overrideBankAccountId ?? advPre.bankAccountId ?? null,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const recipient = resolveInvoiceRecipient({
    contractContractor: null,
    fallbackCustomerName: params.customerName,
    customerAddressLines: params.customerAddressLines,
    customerIco: params.customerIco,
    customerDic: params.customerDic,
  });
  const customerParty = formatCustomerPartyLines(
    recipient.customerName,
    recipient.customerAddressLines,
    recipient.customerIco,
    recipient.customerDic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: params.supplierIco,
    dic: params.supplierDic,
  });

  const html = buildTaxReceiptHtml({
    logoUrl: params.logoUrl ?? null,
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: recipient.customerName,
    customerAddressText: customerParty,
    documentNumber,
    issueDate,
    taxSupplyDate,
    paymentDate: params.paymentDate,
    relatedInvoiceNumber: params.advanceInvoiceNumber,
    jobName: params.jobName,
    amountNet,
    vatRate: params.vatRate,
    vatAmount,
    amountGross,
    variableSymbol: vs,
    bankAccountText: bankText,
    note: params.note,
  });

  const receiptRef = doc(
    collection(params.firestore, "companies", params.companyId, "invoices")
  );
  const financeRef = doc(
    collection(params.firestore, "companies", params.companyId, "finance")
  );
  const jobRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId
  );
  const advanceRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.advanceInvoiceId
  );
  const billingMirrorRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "billingDocuments",
    receiptRef.id
  );

  await runTransaction(params.firestore, async (tx) => {
    const advSnap = await tx.get(advanceRef);
    if (!advSnap.exists()) throw new Error("Zálohová faktura neexistuje.");
    const adv = advSnap.data() as {
      type?: string;
      amountGross?: number;
      paidGrossReceived?: number;
    };
    if (adv.type !== JOB_INVOICE_TYPES.ADVANCE) {
      throw new Error("Neplatný typ dokladu.");
    }
    const advGross = Number(adv.amountGross) || 0;
    const prevPaid = Number(adv.paidGrossReceived) || 0;
    const newTotal = roundMoney2(prevPaid + paidGross);
    if (newTotal > advGross + 0.01) {
      throw new Error("Součet úhrad překračuje zálohovou fakturu.");
    }

    const jobSnap = await tx.get(jobRef);
    if (!jobSnap.exists()) throw new Error("Zakázka neexistuje.");

    tx.set(receiptRef, {
      type: JOB_INVOICE_TYPES.TAX_RECEIPT,
      organizationId: params.companyId,
      companyId: params.companyId,
      jobId: params.jobId,
      relatedInvoiceId: params.advanceInvoiceId,
      customerId: params.customerId,
      customerName: recipient.customerName,
      paidAmount: amountGross,
      issueDate,
      taxSupplyDate,
      paymentDate: params.paymentDate,
      vatRate: params.vatRate,
      amountNet,
      vatAmount,
      amountGross,
      documentNumber,
      status: "paid",
      variableSymbol: vs,
      note: params.note ?? "",
      pdfHtml: html,
      bankAccountId: bankSnap.bankAccountId,
      bankAccountNumber: bankSnap.bankAccountNumber,
      bankCode: bankSnap.bankCode,
      iban: bankSnap.iban,
      swift: bankSnap.swift,
      supplierIco: params.supplierIco ?? null,
      supplierDic: params.supplierDic ?? null,
      customerIco: recipient.customerIco,
      customerDic: recipient.customerDic,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });

    tx.update(jobRef, {
      paidAmountNet: increment(amountNet),
      paidAmountGross: increment(amountGross),
    });

    const nextPaid = newTotal;
    const status =
      nextPaid >= advGross - 0.01 ? "paid" : "partially_paid";

    tx.update(advanceRef, {
      paidGrossReceived: nextPaid,
      status,
      updatedAt: serverTimestamp(),
    });

    tx.set(financeRef, {
      type: "revenue",
      amount: amountGross,
      amountNet,
      amountGross,
      vatRate: params.vatRate,
      vatAmount,
      date: params.paymentDate,
      description: `Přijatá platba — ${documentNumber} (${params.jobDisplayName})`,
      jobId: params.jobId,
      source: "job_tax_receipt_payment",
      invoiceId: receiptRef.id,
      relatedAdvanceInvoiceId: params.advanceInvoiceId,
      jobName: params.jobDisplayName.trim(),
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });

    tx.set(billingMirrorRef, {
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: receiptRef.id,
      relatedInvoiceId: params.advanceInvoiceId,
      kind: JOB_INVOICE_TYPES.TAX_RECEIPT,
      documentNumber,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });
  });

  return { receiptId: receiptRef.id, documentNumber, pdfHtml: html };
}

export type SettlementAdvanceLine = {
  invoiceId: string;
  invoiceNumber: string;
  paidGross: number;
};

/**
 * Vyúčtování: celková cena zakázky mínus zálohy.
 * Zálohy primárně ze zálohových faktur (uhrazená část). Bez duplicity se smlouvou.
 */
export function computeSettlementAmounts(params: {
  budgetGross: number | null;
  advanceInvoices: Array<{
    id: string;
    type?: string;
    invoiceNumber?: string;
    paidGrossReceived?: unknown;
    amountGross?: unknown;
  }>;
  /** Použije se jen pokud u zakázky není žádná zálohová faktura. */
  contractFallback: WorkContractLike | null;
}): {
  totalContractGross: number;
  totalAdvancePaid: number;
  advanceSource: "invoices" | "contract" | "none";
  amountToPay: number;
  relatedAdvanceInvoiceIds: string[];
  advanceLines: SettlementAdvanceLine[];
  advanceRowsForHtml: SettlementAdvanceRow[];
} {
  const totalContractGross =
    params.budgetGross != null && Number.isFinite(params.budgetGross)
      ? roundMoney2(params.budgetGross)
      : 0;

  const advances = params.advanceInvoices.filter(
    (x) => x.type === JOB_INVOICE_TYPES.ADVANCE
  );

  const advanceLines: SettlementAdvanceLine[] = [];
  const advanceRowsForHtml: SettlementAdvanceRow[] = [];
  let totalAdvancePaid = 0;
  let advanceSource: "invoices" | "contract" | "none" = "none";

  if (advances.length > 0) {
    advanceSource = "invoices";
    for (const a of advances) {
      const cap = roundMoney2(Number(a.amountGross) || 0);
      const paidRaw = roundMoney2(Number(a.paidGrossReceived) || 0);
      const paid = cap > 0 ? Math.min(paidRaw, cap) : paidRaw;
      totalAdvancePaid = roundMoney2(totalAdvancePaid + paid);
      advanceLines.push({
        invoiceId: a.id,
        invoiceNumber: String(a.invoiceNumber ?? ""),
        paidGross: paid,
      });
      if (paid > 0) {
        advanceRowsForHtml.push({
          label: `Uhrazená záloha — ${String(a.invoiceNumber ?? a.id)}`,
          amountGross: paid,
        });
      }
    }
  } else if (
    params.contractFallback &&
    params.budgetGross != null &&
    params.budgetGross > 0
  ) {
    const dep = depositGrossKcFromContract(
      params.contractFallback,
      params.budgetGross
    );
    if (dep > 0) {
      advanceSource = "contract";
      totalAdvancePaid = roundMoney2(dep);
      advanceRowsForHtml.push({
        label: "Záloha dle smlouvy o dílo (bez vystavené zálohové faktury)",
        amountGross: dep,
      });
    }
  }

  const amountToPay = Math.max(
    0,
    roundMoney2(totalContractGross - totalAdvancePaid)
  );

  return {
    totalContractGross,
    totalAdvancePaid,
    advanceSource,
    amountToPay,
    relatedAdvanceInvoiceIds: advances.map((a) => a.id),
    advanceLines,
    advanceRowsForHtml,
  };
}

export async function hasFinalSettlementInvoiceForJob(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<boolean> {
  const q = query(
    collection(firestore, "companies", companyId, "invoices"),
    where("jobId", "==", jobId),
    limit(80)
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const x = d.data() as { type?: string };
    if (x.type === JOB_INVOICE_TYPES.FINAL_INVOICE) return true;
  }
  return false;
}

export async function createFinalSettlementInvoice(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  customerId: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  logoUrl?: string | null;
  budget: JobBudgetBreakdown;
  advanceInvoices: Array<{
    id: string;
    type?: string;
    invoiceNumber?: string;
    paidGrossReceived?: unknown;
    amountGross?: unknown;
  }>;
  workContractsForJob: WorkContractLike[];
  userId: string;
  notes?: string;
  sourceContractId?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  legacyCompanyBankAccount?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  overrideBankAccountId?: string | null;
  taxSupplyDate?: string | null;
}): Promise<{ invoiceId: string; invoiceNumber: string; pdfHtml: string }> {
  const dup = await hasFinalSettlementInvoiceForJob(
    params.firestore,
    params.companyId,
    params.jobId
  );
  if (dup) {
    throw new Error("Pro tuto zakázku již existuje vyúčtovací faktura.");
  }

  const primaryContract =
    params.workContractsForJob.find((c) =>
      hasAdvanceTerms(c, params.budget.budgetGross)
    ) ?? params.workContractsForJob[0] ?? null;

  const settlement = computeSettlementAmounts({
    budgetGross: params.budget.budgetGross,
    advanceInvoices: params.advanceInvoices,
    contractFallback:
      params.advanceInvoices.some((i) => i.type === JOB_INVOICE_TYPES.ADVANCE)
        ? null
        : primaryContract,
  });

  const vatRate = normalizeVatRate(params.budget.vatRate);
  const { amountNet, vatAmount, amountGross } = splitGrossToNetVat(
    settlement.amountToPay,
    vatRate
  );

  const lineRow =
    settlement.amountToPay <= 0
      ? singleLineFromGross({
          description: `Vyúčtování zakázky ${params.jobName} — doplatek 0 Kč`,
          amountNet: 0,
          vatRate,
          vatAmount: 0,
          amountGross: 0,
        })
      : singleLineFromGross({
          description: `Doplatek za zakázku ${params.jobName} (po odečtení záloh)`,
          amountNet,
          vatRate,
          vatAmount,
          amountGross,
        });

  const issueDate = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 14);
  const dueDate = due.toISOString().slice(0, 10);
  const taxSupplyDate =
    (params.taxSupplyDate && params.taxSupplyDate.trim()) || issueDate;

  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "FV"
  );
  const vs = resolveInvoiceVariableSymbol({
    contractNumber: primaryContract?.contractNumber,
    invoiceNumber,
  });

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: primaryContract?.bankAccountId,
    contractBankAccountNumber: primaryContract?.bankAccountNumber,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId: params.overrideBankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const recipient = resolveInvoiceRecipient({
    contractContractor: primaryContract?.contractor,
    fallbackCustomerName: params.customerName,
    customerAddressLines: params.customerAddressLines,
    customerIco: params.customerIco,
    customerDic: params.customerDic,
  });
  const customerParty = formatCustomerPartyLines(
    recipient.customerName,
    recipient.customerAddressLines,
    recipient.customerIco,
    recipient.customerDic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: params.supplierIco,
    dic: params.supplierDic,
  });

  const html = buildFinalSettlementInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: recipient.customerName,
    customerAddressText: customerParty,
    invoiceNumber,
    issueDate,
    taxSupplyDate,
    dueDate,
    jobName: params.jobName,
    contractNumber:
      primaryContract?.contractNumber != null
        ? String(primaryContract.contractNumber)
        : null,
    variableSymbol: vs,
    bankAccountText: bankText,
    totalContractGross: settlement.totalContractGross,
    advanceRows:
      settlement.advanceRowsForHtml.length > 0
        ? settlement.advanceRowsForHtml
        : [{ label: "Žádná uhrazená záloha", amountGross: 0 }],
    totalAdvancePaid: settlement.totalAdvancePaid,
    items: [lineRow],
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: `${vatRate}`,
    note: params.notes?.trim() || undefined,
  });

  const invRef = doc(collection(params.firestore, "companies", params.companyId, "invoices"));
  const billingMirrorRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "billingDocuments",
    invRef.id
  );

  await runTransaction(params.firestore, async (tx) => {
    tx.set(invRef, {
      type: JOB_INVOICE_TYPES.FINAL_INVOICE,
      invoiceSubtype: INVOICE_SUBTYPE_SETTLEMENT,
      organizationId: params.companyId,
      companyId: params.companyId,
      jobId: params.jobId,
      customerId: params.customerId,
      customerName: recipient.customerName,
      amountNet,
      vatAmount,
      amountGross,
      vatRate,
      amountType: "gross" as JobBudgetType,
      invoiceNumber,
      issueDate,
      taxSupplyDate,
      dueDate,
      totalContractAmount: settlement.totalContractGross,
      totalAdvancePaid: settlement.totalAdvancePaid,
      amountToPay: settlement.amountToPay,
      advanceSource: settlement.advanceSource,
      relatedAdvanceInvoiceIds: settlement.relatedAdvanceInvoiceIds,
      sourceContractId: params.sourceContractId ?? primaryContract?.id ?? null,
      variableSymbol: vs,
      bankAccountId: bankSnap.bankAccountId,
      bankAccountNumber: bankSnap.bankAccountNumber,
      bankCode: bankSnap.bankCode,
      iban: bankSnap.iban,
      swift: bankSnap.swift,
      supplierIco: params.supplierIco ?? null,
      supplierDic: params.supplierDic ?? null,
      customerIco: recipient.customerIco,
      customerDic: recipient.customerDic,
      status: settlement.amountToPay <= 0 ? "paid" : "unpaid",
      issueStatus: "issued",
      pdfHtml: html,
      items: itemsRowsForFirestore([lineRow]),
      totalAmount: amountGross,
      notes: params.notes ?? "",
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });

    tx.set(billingMirrorRef, {
      companyId: params.companyId,
      jobId: params.jobId,
      invoiceId: invRef.id,
      kind: JOB_INVOICE_TYPES.FINAL_INVOICE,
      invoiceNumber,
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });
  });

  return { invoiceId: invRef.id, invoiceNumber, pdfHtml: html };
}

export async function updateFinalSettlementInvoice(params: {
  firestore: Firestore;
  companyId: string;
  invoiceId: string;
  jobName: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  userId: string;
  logoUrl?: string | null;
  lines: ManualAdvanceLineInput[];
  totalContractGross: number;
  totalAdvancePaid: number;
  notes?: string;
  issueDate?: string;
  dueDate?: string;
  taxSupplyDate?: string;
  variableSymbol?: string;
  contractNumber?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  bankAccountId?: string | null;
  legacyCompanyBankAccount?: string | null;
}): Promise<{ pdfHtml: string }> {
  const { rows, amountNet, vatAmount, amountGross } = computeManualAdvanceTotals(
    params.lines
  );
  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );
  const snap = await getDoc(invRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const inv = snap.data() as {
    type?: string;
    invoiceNumber?: string;
    issueDate?: string;
    dueDate?: string;
    taxSupplyDate?: string;
    variableSymbol?: string;
    jobId?: string;
    sourceContractId?: string | null;
    bankAccountId?: string | null;
    supplierIco?: string | null;
    supplierDic?: string | null;
    customerIco?: string | null;
    customerDic?: string | null;
  };
  if (inv.type !== JOB_INVOICE_TYPES.FINAL_INVOICE) {
    throw new Error("Upravit lze jen vyúčtovací fakturu.");
  }
  const invoiceNumber = String(inv.invoiceNumber ?? "");
  const issueDate = String(
    params.issueDate ?? inv.issueDate ?? new Date().toISOString().slice(0, 10)
  );
  const dueDate = String(params.dueDate ?? inv.dueDate ?? issueDate);
  const taxSupplyDate = String(
    params.taxSupplyDate ?? inv.taxSupplyDate ?? issueDate
  );
  const vs =
    params.variableSymbol != null && String(params.variableSymbol).trim()
      ? String(params.variableSymbol).trim()
      : inv.variableSymbol && String(inv.variableSymbol).trim()
        ? String(inv.variableSymbol).trim()
        : variableSymbolFromInvoiceNumber(invoiceNumber);
  const vatRateDoc = representativeVatRate(rows);
  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);

  const supIco = params.supplierIco ?? inv.supplierIco ?? null;
  const supDic = params.supplierDic ?? inv.supplierDic ?? null;
  const custIco = params.customerIco ?? inv.customerIco ?? null;
  const custDic = params.customerDic ?? inv.customerDic ?? null;

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: null,
    contractBankAccountNumber: null,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId:
      params.bankAccountId !== undefined ? params.bankAccountId : inv.bankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: supIco,
    dic: supDic,
  });
  const customerParty = formatCustomerPartyLines(
    params.customerName,
    params.customerAddressLines,
    custIco,
    custDic
  );

  const advanceRows: SettlementAdvanceRow[] = [
    {
      label: "Souhrn záloh (účetní) — upraveno v dokladu",
      amountGross: roundMoney2(params.totalAdvancePaid),
    },
  ];

  const html = buildFinalSettlementInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: params.customerName,
    customerAddressText: customerParty,
    invoiceNumber,
    issueDate,
    taxSupplyDate,
    dueDate,
    jobName: params.jobName,
    contractNumber:
      params.contractNumber != null && String(params.contractNumber).trim()
        ? String(params.contractNumber).trim()
        : null,
    variableSymbol: vs,
    bankAccountText: bankText,
    totalContractGross: roundMoney2(params.totalContractGross),
    advanceRows,
    totalAdvancePaid: roundMoney2(params.totalAdvancePaid),
    items: rows,
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
    note: params.notes?.trim() || "Vyúčtovací faktura — dokončení zakázky.",
  });

  /** Doplatek = součet položek (shodné s PDF „Celkem k úhradě“). */
  const amountToPay = roundMoney2(amountGross);

  await updateDoc(invRef, {
    amountNet,
    vatAmount,
    amountGross,
    vatRate: vatRateDoc,
    totalAmount: amountGross,
    totalContractAmount: roundMoney2(params.totalContractGross),
    totalAdvancePaid: roundMoney2(params.totalAdvancePaid),
    amountToPay,
    pdfHtml: html,
    items: itemsRowsForFirestore(rows),
    notes: params.notes ?? "",
    variableSymbol: vs,
    issueDate,
    dueDate,
    taxSupplyDate,
    customerName: params.customerName,
    supplierIco: supIco,
    supplierDic: supDic,
    customerIco: custIco,
    customerDic: custDic,
    bankAccountId: bankSnap.bankAccountId,
    bankAccountNumber: bankSnap.bankAccountNumber,
    bankCode: bankSnap.bankCode,
    iban: bankSnap.iban,
    swift: bankSnap.swift,
    updatedAt: serverTimestamp(),
    updatedBy: params.userId,
  });

  return { pdfHtml: html };
}

/** Úprava textů a dat daňového dokladu — částky zůstávají (vazba na finance). */
export async function updateTaxReceiptDocument(params: {
  firestore: Firestore;
  companyId: string;
  invoiceId: string;
  jobName: string;
  customerName: string;
  customerAddressLines: string;
  supplierName: string;
  supplierAddressLines: string;
  userId: string;
  logoUrl?: string | null;
  issueDate?: string;
  taxSupplyDate?: string;
  paymentDate?: string;
  variableSymbol?: string;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  orgBankAccounts?: OrgBankAccountRow[];
  bankAccountId?: string | null;
  legacyCompanyBankAccount?: string | null;
  note?: string;
}): Promise<{ pdfHtml: string }> {
  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );
  const snap = await getDoc(invRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const inv = snap.data() as {
    type?: string;
    documentNumber?: string;
    relatedInvoiceId?: string;
    paymentDate?: string;
    issueDate?: string;
    taxSupplyDate?: string;
    variableSymbol?: string;
    amountNet?: number;
    vatRate?: number;
    vatAmount?: number;
    amountGross?: number;
    bankAccountId?: string | null;
    supplierIco?: string | null;
    supplierDic?: string | null;
    customerIco?: string | null;
    customerDic?: string | null;
    note?: string;
  };
  if (inv.type !== JOB_INVOICE_TYPES.TAX_RECEIPT) {
    throw new Error("Upravit lze jen daňový doklad k platbě.");
  }
  const relatedId = String(inv.relatedInvoiceId ?? "");
  let relatedInvoiceNumber = "—";
  if (relatedId) {
    const advRef = doc(
      params.firestore,
      "companies",
      params.companyId,
      "invoices",
      relatedId
    );
    const advSnap = await getDoc(advRef);
    if (advSnap.exists()) {
      const a = advSnap.data() as { invoiceNumber?: string };
      relatedInvoiceNumber = String(a.invoiceNumber ?? "") || "—";
    }
  }

  const documentNumber = String(inv.documentNumber ?? "");
  const paymentDate = String(
    params.paymentDate ?? inv.paymentDate ?? new Date().toISOString().slice(0, 10)
  );
  const issueDate = String(
    params.issueDate ?? inv.issueDate ?? paymentDate
  );
  const taxSupplyDate = String(
    params.taxSupplyDate ?? inv.taxSupplyDate ?? paymentDate
  );
  const vs =
    params.variableSymbol != null && String(params.variableSymbol).trim()
      ? String(params.variableSymbol).trim()
      : inv.variableSymbol && String(inv.variableSymbol).trim()
        ? String(inv.variableSymbol).trim()
        : variableSymbolFromInvoiceNumber(documentNumber);

  const supIco = params.supplierIco ?? inv.supplierIco ?? null;
  const supDic = params.supplierDic ?? inv.supplierDic ?? null;
  const custIco = params.customerIco ?? inv.customerIco ?? null;
  const custDic = params.customerDic ?? inv.customerDic ?? null;

  const bankSnap = resolveBankAccountForInvoice({
    bankAccounts: params.orgBankAccounts ?? [],
    contractBankAccountId: null,
    contractBankAccountNumber: null,
    legacyCompanyBankLine: params.legacyCompanyBankAccount ?? null,
    overrideBankAccountId:
      params.bankAccountId !== undefined ? params.bankAccountId : inv.bankAccountId,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);

  const recipient = resolveInvoiceRecipient({
    contractContractor: null,
    fallbackCustomerName: params.customerName,
    customerAddressLines: params.customerAddressLines,
    customerIco: custIco,
    customerDic: custDic,
  });
  const customerParty = formatCustomerPartyLines(
    recipient.customerName,
    recipient.customerAddressLines,
    recipient.customerIco,
    recipient.customerDic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: supIco,
    dic: supDic,
  });

  const amountNet = Number(inv.amountNet) || 0;
  const vatRate = normalizeVatRate(Number(inv.vatRate) || 21);
  const vatAmount = Number(inv.vatAmount) || 0;
  const amountGross = Number(inv.amountGross) || 0;

  const html = buildTaxReceiptHtml({
    logoUrl: params.logoUrl ?? null,
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: recipient.customerName,
    customerAddressText: customerParty,
    documentNumber,
    issueDate,
    taxSupplyDate,
    paymentDate,
    relatedInvoiceNumber,
    jobName: params.jobName,
    amountNet,
    vatRate,
    vatAmount,
    amountGross,
    variableSymbol: vs,
    bankAccountText: bankText,
    note: params.note ?? inv.note,
  });

  await updateDoc(invRef, {
    customerName: recipient.customerName,
    issueDate,
    taxSupplyDate,
    paymentDate,
    variableSymbol: vs,
    pdfHtml: html,
    note: params.note ?? inv.note ?? "",
    supplierIco: supIco,
    supplierDic: supDic,
    customerIco: custIco,
    customerDic: custDic,
    bankAccountId: bankSnap.bankAccountId,
    bankAccountNumber: bankSnap.bankAccountNumber,
    bankCode: bankSnap.bankCode,
    iban: bankSnap.iban,
    swift: bankSnap.swift,
    updatedAt: serverTimestamp(),
    updatedBy: params.userId,
  });

  return { pdfHtml: html };
}

export async function deleteJobInvoice(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  invoiceId: string;
}): Promise<void> {
  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    params.invoiceId
  );
  const mirrorRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "billingDocuments",
    params.invoiceId
  );
  const snap = await getDoc(invRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const data = snap.data() as {
    type?: string;
    paidGrossReceived?: number;
    jobId?: string;
  };
  if (data.jobId !== params.jobId) {
    throw new Error("Doklad nepatří k této zakázce.");
  }
  if (data.type === JOB_INVOICE_TYPES.TAX_RECEIPT) {
    throw new Error(
      "Smazání daňového dokladu zatím není podporováno (vazby na platby a finance)."
    );
  }
  if (data.type === JOB_INVOICE_TYPES.ADVANCE) {
    const paid = Number(data.paidGrossReceived) || 0;
    if (paid > 0.01) {
      throw new Error(
        "Zálohovou fakturu s připsanými platbami nelze smazat. Nejdřív odeberte související úhrady."
      );
    }
  }

  await deleteDoc(invRef);
  try {
    await deleteDoc(mirrorRef);
  } catch {
    /* mirror může chybět u starých záznamů */
  }
}
