/**
 * Export zesmluvněných zakázek — určení zesmluvnění, zálohy z daňových dokladů, souhrn.
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { buildJobCustomerAddressBlock } from "@/lib/customer-address-display";
import {
  depositGrossKcFromContract,
  JOB_INVOICE_TYPES,
  selectPrimaryWorkContractForBilling,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import { resolveJobBudgetFromFirestore, roundMoney2 } from "@/lib/vat-calculations";
import {
  formatContractManualDateLabel,
  isJobManuallyContracted,
  parseJobContractManual,
} from "@/lib/job-contract-manual";
import {
  formatCsDateFromFirestore,
  type WorkContractDoc,
} from "@/lib/work-contract-print-html-build";

export type DepositPaymentStatus = "nezaplaceno" | "částečně zaplaceno" | "zaplaceno" | "—";

export type JobInvoiceExportRow = {
  id: string;
  type?: string;
  jobId?: string;
  relatedInvoiceId?: string | null;
  amountGross?: unknown;
  paidGrossReceived?: unknown;
  paymentDate?: string | null;
  issueDate?: string | null;
  taxSupplyDate?: string | null;
  documentNumber?: string | null;
  invoiceNumber?: string | null;
};

export type ContractedJobExportRow = {
  jobId: string;
  jobNumber: string;
  jobName: string;
  customer: string;
  address: string;
  createdAtLabel: string;
  contractedAtLabel: string;
  contractNumber: string;
  totalPriceGross: number;
  requiredDepositGross: number;
  manualDepositGross: number;
  paymentsDepositGross: number;
  totalDepositPaidGross: number;
  manualDepositLabel: string;
  paymentsDepositLabel: string;
  depositPaymentDatesLabel: string;
  depositRemainingGross: number;
  depositStatus: DepositPaymentStatus;
  /** Platby bez jasné vazby na zálohu — zobrazit v exportu zvlášť. */
  otherPaymentsLabel: string;
};

export type ContractedJobsExportSummary = {
  jobCount: number;
  totalPriceGross: number;
  totalRequiredDepositGross: number;
  totalReceivedDepositGross: number;
  totalDepositRemainingGross: number;
};

const CONTRACTED_STATUS = "zesmluvněno";

export function filterBillingWorkContracts(
  contracts: WorkContractDoc[]
): WorkContractDoc[] {
  return contracts.filter((c) => {
    if (c.isTemplate === true) return false;
    const ct = String(c.contractType ?? "").trim();
    if (!ct || ct === "smlouva_o_dilo" || ct === "contract_document") {
      return true;
    }
    return false;
  });
}

function contractHasSavedBody(c: WorkContractDoc): boolean {
  const html = String(c.pdfHtml ?? "").trim();
  if (html.length > 0) return true;
  if (c.pdfSavedAt != null) return true;
  const content = String(c.mainContractContent ?? "").trim();
  const header = String(c.contractHeader ?? "").trim();
  return content.length > 0 || header.length > 0;
}

/**
 * Zakázka je zesmluvněná, pokud má uloženou smlouvu o dílo, číslo SOD/smlouvy,
 * nebo stav „zesmluvněno“.
 */
export function isJobContracted(
  job: Record<string, unknown>,
  contractsForJob: WorkContractDoc[]
): boolean {
  if (isJobManuallyContracted(job)) return true;

  const status = String(job.status ?? "")
    .trim()
    .toLowerCase();
  if (status === CONTRACTED_STATUS) return true;

  const jobNumbers = [
    job.contractNumber,
    job.sodNumber,
    job.workContractNumber,
    job.sod,
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  if (jobNumbers.length > 0) return true;

  const relevant = filterBillingWorkContracts(contractsForJob);

  if (
    relevant.some((c) => {
      const no = String(c.contractNumber ?? "").trim();
      return no.length > 0;
    })
  ) {
    return true;
  }

  return relevant.some((c) => {
    const role = String(c.documentRole ?? "").trim();
    if (role === "attachment") return false;
    return contractHasSavedBody(c);
  });
}

function resolveJobNumber(job: Record<string, unknown>): string {
  const tag = String(job.jobTag ?? "").trim();
  if (tag) return tag;
  const num = String(job.number ?? "").trim();
  if (num) return num;
  return "";
}

function formatAddressOneLine(lines: string[]): string {
  return lines.map((l) => l.trim()).filter(Boolean).join(", ") || "—";
}

function formatPaymentDateLabel(inv: JobInvoiceExportRow): string {
  const raw =
    String(inv.paymentDate ?? "").trim() ||
    String(inv.taxSupplyDate ?? "").trim() ||
    String(inv.issueDate ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split("-");
    if (y && m && d) return `${Number(d)}. ${Number(m)}. ${y}`;
  }
  return raw;
}

export type DepositAggregation = {
  manualDepositGross: number;
  paymentsDepositGross: number;
  totalDepositPaidGross: number;
  paymentDateLabels: string[];
  otherPaymentsLabels: string[];
};

function sumTaxReceiptsForAdvance(
  invoices: JobInvoiceExportRow[],
  advanceId: string
): number {
  let s = 0;
  for (const inv of invoices) {
    if (String(inv.type ?? "") !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    if (String(inv.relatedInvoiceId ?? "").trim() !== advanceId) continue;
    s = roundMoney2(s + (Number(inv.amountGross) || 0));
  }
  return s;
}

/**
 * Zálohy z portálu: daňové doklady k ZF + doplatek z paidGrossReceived na ZF bez dvojího započtení.
 * Ruční záloha se přičítá zvlášť.
 */
export function computeJobDepositAggregation(
  job: Record<string, unknown>,
  invoices: JobInvoiceExportRow[]
): DepositAggregation {
  const manualData = parseJobContractManual(job);
  const manualDepositGross = roundMoney2(
    Math.max(0, Number(manualData.paidDepositGross) || 0)
  );

  const advances = invoices.filter(
    (i) => String(i.type ?? "") === JOB_INVOICE_TYPES.ADVANCE
  );
  const advanceIds = new Set(advances.map((a) => a.id).filter(Boolean));

  let paymentsDepositGross = 0;
  const paymentDateLabels: string[] = [];
  const otherPaymentsLabels: string[] = [];

  for (const inv of invoices) {
    if (String(inv.type ?? "") !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    const gross = roundMoney2(Number(inv.amountGross) || 0);
    if (gross <= 0) continue;
    const related = String(inv.relatedInvoiceId ?? "").trim();
    const docNo =
      String(inv.documentNumber ?? inv.invoiceNumber ?? "").trim() || inv.id;
    const dateLabel = formatPaymentDateLabel(inv);

    if (related && advanceIds.has(related)) {
      paymentsDepositGross = roundMoney2(paymentsDepositGross + gross);
      paymentDateLabels.push(
        dateLabel ? `${dateLabel} (${formatMoneyKc(gross)})` : formatMoneyKc(gross)
      );
    } else {
      const part = dateLabel
        ? `${docNo}: ${formatMoneyKc(gross)} · ${dateLabel}`
        : `${docNo}: ${formatMoneyKc(gross)}`;
      otherPaymentsLabels.push(part);
    }
  }

  for (const adv of advances) {
    const aid = String(adv.id ?? "").trim();
    if (!aid) continue;
    const cap = roundMoney2(Number(adv.amountGross) || 0);
    const paidField = roundMoney2(Number(adv.paidGrossReceived) || 0);
    if (paidField <= 0.009) continue;
    const receiptSum = sumTaxReceiptsForAdvance(invoices, aid);
    const gap = roundMoney2(paidField - receiptSum);
    if (gap <= 0.009) continue;
    const add =
      cap > 0 ? Math.min(gap, Math.max(0, roundMoney2(cap - receiptSum))) : gap;
    paymentsDepositGross = roundMoney2(paymentsDepositGross + add);
    const invNo = String(adv.invoiceNumber ?? adv.documentNumber ?? aid).trim();
    paymentDateLabels.push(
      `ZF ${invNo} (úhrada bez DD): ${formatMoneyKc(add)}`
    );
  }

  const totalDepositPaidGross = roundMoney2(
    manualDepositGross + paymentsDepositGross
  );

  return {
    manualDepositGross,
    paymentsDepositGross,
    totalDepositPaidGross,
    paymentDateLabels,
    otherPaymentsLabels,
  };
}

/** @deprecated Použijte {@link computeJobDepositAggregation}. */
export function aggregateDepositPaymentsFromInvoices(
  invoices: JobInvoiceExportRow[]
): {
  receivedDepositGross: number;
  paymentDateLabels: string[];
  otherPaymentsLabels: string[];
} {
  const agg = computeJobDepositAggregation({}, invoices);
  return {
    receivedDepositGross: agg.paymentsDepositGross,
    paymentDateLabels: agg.paymentDateLabels,
    otherPaymentsLabels: agg.otherPaymentsLabels,
  };
}

export function resolveDepositPaymentStatus(
  requiredGross: number,
  receivedGross: number
): DepositPaymentStatus {
  if (requiredGross <= 0.009) return "—";
  if (receivedGross <= 0.009) return "nezaplaceno";
  if (receivedGross >= requiredGross - 0.01) return "zaplaceno";
  return "částečně zaplaceno";
}

export function formatMoneyKc(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function buildContractedJobExportRow(params: {
  job: Record<string, unknown> & { id: string };
  customer: Record<string, unknown> | null | undefined;
  contractsForJob: WorkContractDoc[];
  invoices: JobInvoiceExportRow[];
}): ContractedJobExportRow | null {
  const { job, customer, contractsForJob, invoices } = params;
  if (!isJobContracted(job, contractsForJob)) return null;

  const filteredContracts = filterBillingWorkContracts(contractsForJob);
  const contractLikes: WorkContractLike[] = filteredContracts.map((c) => ({
    id: c.id,
    contractNumber: c.contractNumber,
    depositAmount: c.depositAmount,
    depositPercentage: c.depositPercentage,
    zalohovaCastka: c.zalohovaCastka,
    zalohovaProcenta: c.zalohovaProcenta,
    documentRole: c.documentRole,
  }));

  const budget = resolveJobBudgetFromFirestore(job);
  const budgetGross = budget?.budgetGross ?? null;
  const primary = selectPrimaryWorkContractForBilling(contractLikes, budgetGross);

  const manual = parseJobContractManual(job);

  const requiredDepositGross =
    manual.requiredDepositGross != null && Number.isFinite(manual.requiredDepositGross)
      ? roundMoney2(manual.requiredDepositGross)
      : primary
        ? depositGrossKcFromContract(primary, budgetGross)
        : 0;

  const depositAgg = computeJobDepositAggregation(job, invoices);
  const totalDepositPaidGross = depositAgg.totalDepositPaidGross;
  const depositRemainingGross = Math.max(
    0,
    roundMoney2(requiredDepositGross - totalDepositPaidGross)
  );

  const addrBlock = buildJobCustomerAddressBlock(job, customer);
  const customerName =
    addrBlock.displayName ||
    String(job.customerName ?? "").trim() ||
    "—";

  let contractNumber = "";
  if (primary?.contractNumber) {
    contractNumber = String(primary.contractNumber).trim();
  }
  if (!contractNumber) {
    for (const c of filteredContracts) {
      const no = String(c.contractNumber ?? "").trim();
      if (no) {
        contractNumber = no;
        break;
      }
    }
  }
  if (!contractNumber) {
    contractNumber =
      [
        job.contractNumber,
        job.sodNumber,
        job.workContractNumber,
      ]
        .map((x) => String(x ?? "").trim())
        .find(Boolean) ?? "";
  }

  let contractedAtLabel = "";
  if (primary) {
    const src = filteredContracts.find((c) => c.id === primary.id);
    if (src) {
      contractedAtLabel =
        formatCsDateFromFirestore(src.contractIssuedAt) ||
        formatCsDateFromFirestore(src.pdfSavedAt) ||
        formatCsDateFromFirestore(src.updatedAt) ||
        "";
    }
  }
  if (!contractedAtLabel) {
    for (const c of filteredContracts) {
      const d =
        formatCsDateFromFirestore(c.contractIssuedAt) ||
        formatCsDateFromFirestore(c.pdfSavedAt);
      if (d) {
        contractedAtLabel = d;
        break;
      }
    }
  }

  const createdAtLabel =
    formatCsDateFromFirestore(job.createdAt) ||
    String(job.startDate ?? "").trim() ||
    "—";

  const totalPriceGross =
    manual.totalPriceGross != null && Number.isFinite(manual.totalPriceGross)
      ? roundMoney2(manual.totalPriceGross)
      : budgetGross != null && Number.isFinite(budgetGross)
        ? roundMoney2(budgetGross)
        : 0;

  return {
    jobId: job.id,
    jobNumber: resolveJobNumber(job) || "—",
    jobName: String(job.name ?? "").trim() || "—",
    customer: customerName,
    address: formatAddressOneLine(addrBlock.addressLines),
    createdAtLabel: createdAtLabel || "—",
    contractedAtLabel: contractedAtLabel || "—",
    contractNumber: contractNumber || "—",
    totalPriceGross,
    requiredDepositGross,
    manualDepositGross: depositAgg.manualDepositGross,
    paymentsDepositGross: depositAgg.paymentsDepositGross,
    totalDepositPaidGross,
    manualDepositLabel:
      depositAgg.manualDepositGross > 0
        ? formatMoneyKc(depositAgg.manualDepositGross)
        : "—",
    paymentsDepositLabel:
      depositAgg.paymentsDepositGross > 0
        ? formatMoneyKc(depositAgg.paymentsDepositGross)
        : "—",
    depositPaymentDatesLabel:
      depositAgg.paymentDateLabels.length > 0
        ? depositAgg.paymentDateLabels.join("; ")
        : "—",
    depositRemainingGross,
    depositStatus: resolveDepositPaymentStatus(
      requiredDepositGross,
      totalDepositPaidGross
    ),
    otherPaymentsLabel:
      depositAgg.otherPaymentsLabels.length > 0
        ? depositAgg.otherPaymentsLabels.join("; ")
        : "—",
  };
}

export function buildContractedJobsExportSummary(
  rows: ContractedJobExportRow[]
): ContractedJobsExportSummary {
  let totalPriceGross = 0;
  let totalRequiredDepositGross = 0;
  let totalReceivedDepositGross = 0;
  let totalDepositRemainingGross = 0;
  for (const r of rows) {
    totalPriceGross = roundMoney2(totalPriceGross + r.totalPriceGross);
    totalRequiredDepositGross = roundMoney2(
      totalRequiredDepositGross + r.requiredDepositGross
    );
    totalReceivedDepositGross = roundMoney2(
      totalReceivedDepositGross + r.totalDepositPaidGross
    );
    totalDepositRemainingGross = roundMoney2(
      totalDepositRemainingGross + r.depositRemainingGross
    );
  }
  return {
    jobCount: rows.length,
    totalPriceGross,
    totalRequiredDepositGross,
    totalReceivedDepositGross,
    totalDepositRemainingGross,
  };
}

export async function fetchWorkContractsForJob(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<WorkContractDoc[]> {
  const snap = await getDocs(
    collection(
      firestore,
      "companies",
      companyId,
      "jobs",
      jobId,
      "workContracts"
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkContractDoc);
}

export async function fetchInvoicesForJob(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<JobInvoiceExportRow[]> {
  const snap = await getDocs(
    query(
      collection(firestore, "companies", companyId, "invoices"),
      where("jobId", "==", jobId),
      limit(80)
    )
  );
  const rows: JobInvoiceExportRow[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!isActiveFirestoreDoc(data)) continue;
    rows.push({ id: d.id, ...data } as JobInvoiceExportRow);
  }
  return rows;
}

export async function buildContractedJobsExportRows(params: {
  firestore: Firestore;
  companyId: string;
  jobs: Array<Record<string, unknown> & { id: string }>;
  customersById: Map<string, Record<string, unknown>>;
}): Promise<ContractedJobExportRow[]> {
  const rows: ContractedJobExportRow[] = [];
  for (const job of params.jobs) {
    const jid = String(job.id ?? "").trim();
    if (!jid) continue;
    const [contracts, invoices] = await Promise.all([
      fetchWorkContractsForJob(params.firestore, params.companyId, jid),
      fetchInvoicesForJob(params.firestore, params.companyId, jid),
    ]);
    const customerId = String(job.customerId ?? "").trim();
    const customer = customerId
      ? params.customersById.get(customerId)
      : undefined;
    const row = buildContractedJobExportRow({
      job,
      customer,
      contractsForJob: contracts,
      invoices,
    });
    if (row) rows.push(row);
  }
  rows.sort((a, b) =>
    a.jobName.localeCompare(b.jobName, "cs", { sensitivity: "base" })
  );
  return rows;
}

export function downloadContractedJobsCsv(
  rows: ContractedJobExportRow[],
  summary: ContractedJobsExportSummary,
  fileName?: string
): void {
  const header = [
    "cislo_zakazky",
    "nazev",
    "zakaznik",
    "adresa",
    "datum_vytvoreni",
    "datum_zesmluvneni",
    "cislo_smlouvy",
    "celkova_cena",
    "pozadovana_zaloha",
    "zaloha_rucne",
    "zaloha_z_plateb",
    "celkem_zaplaceno_zaloha",
    "datumy_plateb_zaloh",
    "zbyva_zaloha",
    "stav_zalohy",
    "ostatni_platby",
  ];
  const esc = (c: string | number) => {
    const s = String(c);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = rows.map((r) =>
    [
      r.jobNumber,
      r.jobName,
      r.customer,
      r.address,
      r.createdAtLabel,
      r.contractedAtLabel,
      r.contractNumber,
      r.totalPriceGross,
      r.requiredDepositGross,
      r.manualDepositGross,
      r.paymentsDepositGross,
      r.totalDepositPaidGross,
      r.depositPaymentDatesLabel,
      r.depositRemainingGross,
      r.depositStatus,
      r.otherPaymentsLabel,
    ]
      .map(esc)
      .join(",")
  );
  const summaryLines = [
    "",
    esc("SOUHRN"),
    esc(`pocet_zakazek;${summary.jobCount}`),
    esc(`soucet_cen;${summary.totalPriceGross}`),
    esc(`soucet_pozadovanych_zaloh;${summary.totalRequiredDepositGross}`),
    esc(`soucet_prijatych_zaloh;${summary.totalReceivedDepositGross}`),
    esc(`soucet_zbyva_zaloh;${summary.totalDepositRemainingGross}`),
  ];
  const csv = ["\ufeff" + [header.map(esc).join(","), ...body, ...summaryLines].join("\n")];
  const blob = new Blob(csv, { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (fileName || `zesmluvnene-zakazky-${new Date().toISOString().slice(0, 10)}`) +
    ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
