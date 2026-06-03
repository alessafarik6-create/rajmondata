/**
 * Sestavení kontextu a snapshotů pro předávací protokol z zakázky, zákazníka a smlouvy.
 */

import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";
import { formatCsDateFromFirestore } from "@/lib/work-contract-print-html-build";
import { deriveCustomerDisplayNameFromJob, buildClientTextFromJobSnapshot } from "@/lib/job-customer-client";
import { buildJobCustomerAddressBlock } from "@/lib/customer-address-display";
import {
  defaultHandoverProtocolForm,
  type HandoverProtocolForm,
} from "@/lib/handover-protocol-types";

export type HandoverProtocolBuildInput = {
  companyId: string;
  jobId: string;
  job: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  companyDoc: Record<string, unknown> | null;
  workContract: WorkContractDoc | null;
  workContractId: string;
  existingForm?: HandoverProtocolForm | null;
};

export type HandoverProtocolSnapshot = {
  jobNumber: string;
  jobName: string;
  workContractNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  realizationAddress: string;
  createdAtLabel: string;
  contractorCompanyName: string;
  customerId: string | null;
  form: HandoverProtocolForm;
};

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildHandoverProtocolSnapshot(
  input: HandoverProtocolBuildInput
): HandoverProtocolSnapshot {
  const job = input.job ?? {};
  const customer = input.customer;
  const wc = input.workContract;

  const jobNumber = trim(
    job.jobNumber ?? job.orderNumber ?? job.documentNumber ?? job.jobTag
  );
  const jobName = trim(job.name ?? job.title ?? job.jobTitle) || "Zakázka";
  const workContractNumber = trim(wc?.contractNumber) || trim(wc?.id) || "—";

  const customerName =
    trim(customer?.name ?? customer?.displayName ?? customer?.companyName) ||
    deriveCustomerDisplayNameFromJob(job) ||
    buildClientTextFromJobSnapshot(job).split("\n")[0]?.trim() ||
    "Zákazník";

  const customerPhone =
    trim(customer?.phone ?? customer?.phoneNumber) ||
    trim(job.customerPhone) ||
    "";

  const customerEmail =
    trim(customer?.email) || trim(job.customerEmail) || "";

  const addrBlock = buildJobCustomerAddressBlock(job, customer);
  const realizationAddress =
    (addrBlock.addressLines.length > 0 ? addrBlock.addressLines.join("\n") : "") ||
    trim(job.address ?? job.siteAddress ?? job.realizationAddress) ||
    "";

  const company = input.companyDoc ?? {};
  const contractorCompanyName =
    trim(company.name ?? company.displayName ?? company.companyName) || "Organizace";

  const createdAtLabel = formatCsDateFromFirestore(new Date()) || new Intl.DateTimeFormat("cs-CZ").format(new Date());

  const base = input.existingForm ?? defaultHandoverProtocolForm();
  const form: HandoverProtocolForm = {
    ...base,
    documentTitle: base.documentTitle || "Předávací protokol",
    handoverDateLabel: base.handoverDateLabel || createdAtLabel,
  };

  return {
    jobNumber,
    jobName,
    workContractNumber,
    customerName,
    customerPhone,
    customerEmail,
    realizationAddress,
    createdAtLabel,
    contractorCompanyName,
    customerId: trim(customer?.id ?? job.customerId) || null,
    form,
  };
}
