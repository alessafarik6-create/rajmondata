/**
 * Export zesmluvněných zakázek — určení zesmluvnění, zálohy, souhrn.
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { buildJobCustomerAddressBlock } from "@/lib/customer-address-display";
import {
  calculateJobPaymentSummary,
  formatMoneyKc,
  paymentStatusLabelCs,
  type DepositPaymentStatus,
  type JobIncomeForDeposit,
  type JobInvoiceForDeposit,
} from "@/lib/job-payment-summary";
import { selectPrimaryWorkContractForBilling, type WorkContractLike } from "@/lib/job-billing-invoices";
import { formatContractManualDateLabel, isJobManuallyContracted, parseJobContractManual } from "@/lib/job-contract-manual";
import { resolveJobBudgetFromFirestore, roundMoney2 } from "@/lib/vat-calculations";
import {
  formatCsDateFromFirestore,
  type WorkContractDoc,
} from "@/lib/work-contract-print-html-build";

export type { DepositPaymentStatus } from "@/lib/job-payment-summary";
export { formatMoneyKc, paymentStatusLabelCs as depositStatusLabelCs } from "@/lib/job-payment-summary";

export type JobInvoiceExportRow = JobInvoiceForDeposit;

export type ContractedJobExportRow = {
  jobId: string;
  jobNumber: string;
  jobName: string;
  customer: string;
  address: string;
  createdAtLabel: string;
  /** Datum zesmluvnění (pokud existuje). */
  contractedAtLabel: string;
  /** Pro PDF/CSV: datum, „ANO“ nebo „NE“. */
  contractedDisplayValue: string;
  contractNumber: string;
  totalPriceGross: number;
  requiredDepositGross: number;
  manualDepositGross: number;
  paymentsDepositGross: number;
  /** @deprecated použijte {@link totalPaidGross} */
  totalDepositPaidGross: number;
  totalPaidGross: number;
  remainingToPayGross: number;
  manualDepositLabel: string;
  paymentsDepositLabel: string;
  depositPaymentDatesLabel: string;
  depositRemainingGross: number;
  depositStatus: DepositPaymentStatus;
  jobPaymentStatus: DepositPaymentStatus;
  depositNote: string;
  otherPaymentsLabel: string;
};

export type ContractedJobsExportSummary = {
  jobCount: number;
  totalPriceGross: number;
  totalRequiredDepositGross: number;
  totalReceivedDepositGross: number;
  totalDepositRemainingGross: number;
  totalRemainingToPayGross: number;
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

  const manual = parseJobContractManual(job);
  if (manual.contractNumber) return true;
  if (manual.contractedAt) return true;

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

export function buildContractedJobExportRow(params: {
  job: Record<string, unknown> & { id: string };
  customer: Record<string, unknown> | null | undefined;
  contractsForJob: WorkContractDoc[];
  invoices: JobInvoiceExportRow[];
  jobIncomes?: JobIncomeForDeposit[];
}): ContractedJobExportRow | null {
  const { job, customer, contractsForJob, invoices, jobIncomes } = params;
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

  let contractedAtLabel = manual.contractedAt
    ? formatContractManualDateLabel(manual.contractedAt)
    : "";
  if (!contractedAtLabel && primary) {
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

  const payment = calculateJobPaymentSummary({
    job,
    invoices,
    workContracts: filteredContracts,
    jobIncomes,
    contractedDateFallback: contractedAtLabel,
    isContracted: true,
  });

  const addrBlock = buildJobCustomerAddressBlock(job, customer);
  const customerName =
    addrBlock.displayName ||
    String(job.customerName ?? "").trim() ||
    "—";

  let contractNumber = manual.contractNumber?.trim() || "";
  if (!contractNumber && primary?.contractNumber) {
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

  const createdAtLabel =
    formatCsDateFromFirestore(job.createdAt) ||
    String(job.startDate ?? "").trim() ||
    "—";

  return {
    jobId: job.id,
    jobNumber: resolveJobNumber(job) || "—",
    jobName: String(job.name ?? "").trim() || "—",
    customer: customerName,
    address: formatAddressOneLine(addrBlock.addressLines),
    createdAtLabel: createdAtLabel || "—",
    contractedAtLabel: contractedAtLabel || "—",
    contractedDisplayValue: payment.contractedDisplayValue,
    contractNumber: contractNumber || "—",
    totalPriceGross: payment.totalPriceGross,
    requiredDepositGross: payment.requiredDepositGross,
    manualDepositGross: payment.manualDepositGross,
    paymentsDepositGross: payment.paymentsDepositGross,
    totalDepositPaidGross: payment.totalPaidGross,
    totalPaidGross: payment.totalPaidGross,
    remainingToPayGross: payment.remainingToPayGross,
    manualDepositLabel:
      payment.manualDepositGross > 0
        ? formatMoneyKc(payment.manualDepositGross)
        : "—",
    paymentsDepositLabel:
      payment.paymentsDepositGross > 0
        ? formatMoneyKc(payment.paymentsDepositGross)
        : "—",
    depositPaymentDatesLabel:
      payment.paymentDateLabels.length > 0
        ? payment.paymentDateLabels.join("; ")
        : "—",
    depositRemainingGross: payment.depositRemainingGross,
    depositStatus: payment.depositStatus,
    jobPaymentStatus: payment.jobPaymentStatus,
    depositNote: payment.depositNote?.trim() || "—",
    otherPaymentsLabel:
      payment.otherPaymentsLabels.length > 0
        ? payment.otherPaymentsLabels.join("; ")
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
  let totalRemainingToPayGross = 0;
  for (const r of rows) {
    totalPriceGross = roundMoney2(totalPriceGross + r.totalPriceGross);
    totalRequiredDepositGross = roundMoney2(
      totalRequiredDepositGross + r.requiredDepositGross
    );
    totalReceivedDepositGross = roundMoney2(
      totalReceivedDepositGross + r.totalPaidGross
    );
    totalDepositRemainingGross = roundMoney2(
      totalDepositRemainingGross + r.depositRemainingGross
    );
    totalRemainingToPayGross = roundMoney2(
      totalRemainingToPayGross + r.remainingToPayGross
    );
  }
  return {
    jobCount: rows.length,
    totalPriceGross,
    totalRequiredDepositGross,
    totalReceivedDepositGross,
    totalDepositRemainingGross,
    totalRemainingToPayGross,
  };
}

export async function fetchJobDocument(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<Record<string, unknown> & { id: string }> {
  const ref = doc(firestore, "companies", companyId, "jobs", jobId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { id: jobId };
  }
  return { id: snap.id, ...snap.data() } as Record<string, unknown> & { id: string };
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
      limit(120)
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

export async function fetchJobIncomesForJob(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<JobIncomeForDeposit[]> {
  const snap = await getDocs(
    collection(firestore, "companies", companyId, "jobs", jobId, "incomes")
  );
  return snap.docs.map((d) => ({ ...d.data() }) as JobIncomeForDeposit);
}

/** @deprecated Použijte {@link calculateJobPaymentSummary}. */
export function computeJobDepositAggregation(
  job: Record<string, unknown>,
  invoices: JobInvoiceExportRow[]
) {
  const p = calculateJobPaymentSummary({ job, invoices });
  return {
    manualDepositGross: p.manualDepositGross,
    paymentsDepositGross: p.paymentsDepositGross,
    totalDepositPaidGross: p.totalPaidGross,
    paymentDateLabels: p.paymentDateLabels,
    otherPaymentsLabels: p.otherPaymentsLabels,
  };
}

export async function buildContractedJobsExportRows(params: {
  firestore: Firestore;
  companyId: string;
  jobs: Array<Record<string, unknown> & { id: string }>;
  customersById: Map<string, Record<string, unknown>>;
}): Promise<ContractedJobExportRow[]> {
  const rows: ContractedJobExportRow[] = [];
  for (const jobSeed of params.jobs) {
    const jid = String(jobSeed.id ?? "").trim();
    if (!jid) continue;

    const [jobFresh, contracts, invoices, jobIncomes] = await Promise.all([
      fetchJobDocument(params.firestore, params.companyId, jid),
      fetchWorkContractsForJob(params.firestore, params.companyId, jid),
      fetchInvoicesForJob(params.firestore, params.companyId, jid),
      fetchJobIncomesForJob(params.firestore, params.companyId, jid),
    ]);

    const customerId = String(jobFresh.customerId ?? jobSeed.customerId ?? "").trim();
    const customer = customerId
      ? params.customersById.get(customerId)
      : undefined;

    const row = buildContractedJobExportRow({
      job: jobFresh,
      customer,
      contractsForJob: contracts,
      invoices,
      jobIncomes,
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
    "celkem_zaplaceno",
    "zbyva_doplatit",
    "stav_zalohy",
    "stav_zakazky",
    "datumy_plateb",
    "poznamka_zaloha",
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
      r.contractedDisplayValue || r.contractedAtLabel,
      r.contractNumber,
      r.totalPriceGross,
      r.requiredDepositGross,
      r.manualDepositGross,
      r.paymentsDepositGross,
      r.totalPaidGross,
      r.remainingToPayGross,
      paymentStatusLabelCs(r.depositStatus),
      paymentStatusLabelCs(r.jobPaymentStatus),
      r.depositPaymentDatesLabel,
      r.depositNote,
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
    esc(`soucet_celkem_zaplaceno;${summary.totalReceivedDepositGross}`),
    esc(`soucet_zbyva_doplatit;${summary.totalRemainingToPayGross}`),
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
