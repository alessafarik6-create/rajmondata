/**
 * Zálohové faktury a daňové doklady k přijaté platbě — vazba na smlouvu o dílo a zakázku.
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
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
  buildTaxReceiptHtml,
  singleLineFromGross,
  type InvoiceLineRow,
} from "@/lib/invoice-a4-html";

export const JOB_INVOICE_TYPES = {
  ADVANCE: "advance_invoice",
  TAX_RECEIPT: "tax_receipt_received_payment",
} as const;

export type JobInvoiceType =
  (typeof JOB_INVOICE_TYPES)[keyof typeof JOB_INVOICE_TYPES];

export type WorkContractLike = {
  id: string;
  contractNumber?: string | null;
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

function nextInvoiceNo(prefix: string): string {
  const y = new Date().getFullYear();
  const r = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${y}-${r}`;
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
  const invoiceNumber = nextInvoiceNo("ZF");
  const vs = variableSymbolFromInvoiceNumber(invoiceNumber);
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
    supplierAddressText: params.supplierAddressLines || params.supplierName,
    customerName: params.customerName,
    customerAddressText: params.customerAddressLines || params.customerName,
    invoiceNumber,
    issueDate,
    dueDate,
    jobName: params.jobName,
    contractNumber: params.contract.contractNumber != null ? String(params.contract.contractNumber) : null,
    variableSymbol: vs,
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
      customerName: params.customerName,
      amountNet,
      vatAmount,
      amountGross,
      vatRate,
      amountType: "gross" as JobBudgetType,
      invoiceNumber,
      issueDate,
      dueDate,
      source: "contract",
      sourceContractId: params.contract.id,
      contractNumber:
        params.contract.contractNumber != null
          ? String(params.contract.contractNumber)
          : null,
      variableSymbol: vs,
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
  const invoiceNumber = nextInvoiceNo("ZF");
  const vs = variableSymbolFromInvoiceNumber(invoiceNumber);
  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);

  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierAddressText: params.supplierAddressLines || params.supplierName,
    customerName: params.customerName,
    customerAddressText: params.customerAddressLines || params.customerName,
    invoiceNumber,
    issueDate,
    dueDate,
    jobName: params.jobName,
    contractNumber: null,
    variableSymbol: vs,
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
      customerName: params.customerName,
      amountNet,
      vatAmount,
      amountGross,
      vatRate: vatRateDoc,
      amountType: "gross" as JobBudgetType,
      invoiceNumber,
      issueDate,
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
    variableSymbol?: string;
    sourceContractId?: string;
    contractNumber?: string | null;
  };
  if (inv.type !== JOB_INVOICE_TYPES.ADVANCE) {
    throw new Error("Upravit lze jen zálohovou fakturu.");
  }
  const invoiceNumber = String(inv.invoiceNumber ?? "");
  const issueDate = String(inv.issueDate ?? new Date().toISOString().slice(0, 10));
  const dueDate = String(inv.dueDate ?? issueDate);
  const vs =
    inv.variableSymbol && String(inv.variableSymbol).trim()
      ? String(inv.variableSymbol).trim()
      : variableSymbolFromInvoiceNumber(invoiceNumber);
  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);

  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierAddressText: params.supplierAddressLines || params.supplierName,
    customerName: params.customerName,
    customerAddressText: params.customerAddressLines || params.customerName,
    invoiceNumber,
    issueDate,
    dueDate,
    jobName: params.jobName,
    contractNumber:
      inv.contractNumber != null && String(inv.contractNumber).trim()
        ? String(inv.contractNumber).trim()
        : null,
    variableSymbol: vs,
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

  const documentNumber = nextInvoiceNo("DD");

  const html = buildTaxReceiptHtml({
    logoUrl: params.logoUrl ?? null,
    supplierName: params.supplierName,
    supplierAddressText: params.supplierAddressLines || params.supplierName,
    customerName: params.customerName,
    customerAddressText: params.customerAddressLines || params.customerName,
    documentNumber,
    paymentDate: params.paymentDate,
    relatedInvoiceNumber: params.advanceInvoiceNumber,
    jobName: params.jobName,
    amountNet,
    vatRate: params.vatRate,
    vatAmount,
    amountGross,
    variableSymbol: params.variableSymbol,
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
      customerName: params.customerName,
      paidAmount: amountGross,
      paymentDate: params.paymentDate,
      vatRate: params.vatRate,
      amountNet,
      vatAmount,
      amountGross,
      documentNumber,
      status: "paid",
      variableSymbol: params.variableSymbol ?? "",
      note: params.note ?? "",
      pdfHtml: html,
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
