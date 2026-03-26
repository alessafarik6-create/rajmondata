/**
 * Zálohové faktury a daňové doklady k přijaté platbě — vazba na smlouvu o dílo a zakázku.
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAdvanceInvoiceHtml(params: {
  title: string;
  supplierName: string;
  supplierLines: string;
  customerName: string;
  customerLines: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  jobName: string;
  contractNumber?: string | null;
  amountNet: number;
  vatRate: number;
  vatAmount: number;
  amountGross: number;
  note?: string;
}): string {
  const fmt = (n: number) =>
    `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><title>${escapeHtml(
    params.title
  )}</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#000;max-width:720px;margin:24px auto;padding:16px;line-height:1.45}
h1{font-size:1.25rem;margin:0 0 8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
.box{border:1px solid #ccc;padding:12px;border-radius:8px}
table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:6px 8px;border-bottom:1px solid #eee}
td:first-child{color:#333;width:55%}
.amount{font-size:1.15rem;font-weight:700}
.note{font-size:0.9rem;color:#333;margin-top:12px}
</style></head><body>
<h1>${escapeHtml(params.title)}</h1>
<p><strong>Číslo:</strong> ${escapeHtml(params.invoiceNumber)}</p>
<p><strong>Datum vystavení:</strong> ${escapeHtml(params.issueDate)} &nbsp;·&nbsp; <strong>Splatnost:</strong> ${escapeHtml(params.dueDate)}</p>
<p><strong>Zakázka:</strong> ${escapeHtml(params.jobName)}</p>
${params.contractNumber ? `<p><strong>Smlouva č.:</strong> ${escapeHtml(params.contractNumber)}</p>` : ""}
<div class="grid">
<div class="box"><strong>Dodavatel</strong><div style="white-space:pre-wrap;margin-top:6px">${params.supplierLines}</div></div>
<div class="box"><strong>Odběratel</strong><div style="white-space:pre-wrap;margin-top:6px">${params.customerLines}</div></div>
</div>
<table>
<tr><td>Základ daně</td><td class="amount" style="text-align:right">${fmt(params.amountNet)}</td></tr>
<tr><td>DPH (${params.vatRate} %)</td><td style="text-align:right">${fmt(params.vatAmount)}</td></tr>
<tr><td><strong>Celkem k úhradě</strong></td><td class="amount" style="text-align:right">${fmt(params.amountGross)}</td></tr>
</table>
<p class="note">${escapeHtml(params.note ?? "Doklad slouží jako zálohová faktura dle smlouvy o dílo.")}</p>
</body></html>`;
}

export function buildTaxReceiptHtml(params: {
  supplierName: string;
  supplierLines: string;
  customerName: string;
  customerLines: string;
  documentNumber: string;
  paymentDate: string;
  relatedInvoiceNumber: string;
  jobName: string;
  amountNet: number;
  vatRate: number;
  vatAmount: number;
  amountGross: number;
  variableSymbol?: string;
  note?: string;
}): string {
  const fmt = (n: number) =>
    `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><title>Daňový doklad k přijaté platbě</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#000;max-width:720px;margin:24px auto;padding:16px;line-height:1.45}
h1{font-size:1.2rem;margin:0 0 8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
.box{border:1px solid #ccc;padding:12px;border-radius:8px}
table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:6px 8px;border-bottom:1px solid #eee}
.amount{font-size:1.1rem;font-weight:700}
</style></head><body>
<h1>Daňový doklad k přijaté platbě</h1>
<p><strong>Číslo dokladu:</strong> ${escapeHtml(params.documentNumber)}</p>
<p><strong>Datum přijetí platby:</strong> ${escapeHtml(params.paymentDate)}</p>
<p><strong>Vazba na zálohovou fakturu:</strong> ${escapeHtml(params.relatedInvoiceNumber)}</p>
<p><strong>Zakázka:</strong> ${escapeHtml(params.jobName)}</p>
${params.variableSymbol ? `<p><strong>Variabilní symbol:</strong> ${escapeHtml(params.variableSymbol)}</p>` : ""}
<div class="grid">
<div class="box"><strong>Dodavatel</strong><div style="white-space:pre-wrap;margin-top:6px">${params.supplierLines}</div></div>
<div class="box"><strong>Odběratel</strong><div style="white-space:pre-wrap;margin-top:6px">${params.customerLines}</div></div>
</div>
<table>
<tr><td>Základ daně</td><td class="amount" style="text-align:right">${fmt(params.amountNet)}</td></tr>
<tr><td>DPH (${params.vatRate} %)</td><td style="text-align:right">${fmt(params.vatAmount)}</td></tr>
<tr><td><strong>Uhrazeno celkem</strong></td><td class="amount" style="text-align:right">${fmt(params.amountGross)}</td></tr>
</table>
<p style="font-size:0.9rem;color:#333">${escapeHtml(params.note ?? "Doklad potvrzuje přijetí platby na účet a plní účetní funkci daňového dokladu k přijaté platbě.")}</p>
</body></html>`;
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

  const brJoin = (text: string) =>
    text
      .split("\n")
      .map((l) => escapeHtml(l))
      .join("<br/>");

  const html = buildAdvanceInvoiceHtml({
    title: "Zálohová faktura",
    supplierName: params.supplierName,
    supplierLines: brJoin(params.supplierAddressLines),
    customerName: params.customerName,
    customerLines: brJoin(params.customerAddressLines),
    invoiceNumber,
    issueDate,
    dueDate,
    jobName: params.jobName,
    contractNumber: params.contract.contractNumber != null ? String(params.contract.contractNumber) : null,
    amountNet,
    vatRate,
    vatAmount,
    amountGross,
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
      /** Stav úhrady zálohové faktury */
      status: "unpaid",
      /** Dokument je vystavený (ne koncept) */
      issueStatus: "issued",
      paidGrossReceived: 0,
      pdfHtml: html,
      items: [
        {
          description: `Záloha dle smlouvy o dílo — zakázka ${params.jobName}`,
          quantity: 1,
          unitPrice: amountNet,
        },
      ],
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
  const brJoin = (text: string) =>
    text
      .split("\n")
      .map((l) => escapeHtml(l))
      .join("<br/>");

  const html = buildTaxReceiptHtml({
    supplierName: params.supplierName,
    supplierLines: brJoin(params.supplierAddressLines),
    customerName: params.customerName,
    customerLines: brJoin(params.customerAddressLines),
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
