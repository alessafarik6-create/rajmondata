/**
 * Načte data ze Firestore (Admin) a sestaví stejné tiskové HTML smlouvy jako tlačítko „Generovat PDF“.
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { JobTemplate } from "@/lib/job-templates";
import { resolveJobBudgetFromFirestore } from "@/lib/vat-calculations";
import { validateWorkContractDeposit } from "@/lib/work-contract-deposit";
import {
  buildWorkContractPrintHtmlString,
  type WorkContractBankAccountLike,
  type WorkContractDoc,
  type WorkContractForm,
  type WorkContractPrintHtmlBuildContext,
  workContractDocToForm,
} from "@/lib/work-contract-print-html-build";
import { errorStackFromUnknown, serializeUnknownForLog } from "@/lib/server-error-serialize";

const LOG = "[work-contract-email-html]";

function log(phase: string, detail?: string): void {
  const tail = detail != null && detail !== "" ? ` ${detail}` : "";
  console.info(`${LOG} ${phase}${tail}`);
}

function companyRootBankAccountNumber(company: Record<string, unknown>): string {
  const c = company;
  return String(
    c.bankAccountNumber ??
      c.bankAccount ??
      c.bank_account ??
      c.accountNumber ??
      c.ucet ??
      c.account ??
      c.iban ??
      c.IBAN ??
      ""
  ).trim();
}

export type BuildWorkContractHtmlForEmailResult =
  | { ok: true; html: string; form: WorkContractForm }
  | { ok: false; error: string; detail: string | null };

/**
 * Sestaví HTML pro PDF přílohu e-mailu ze stavu dokumentu ve Firestore (bez `pdfHtml`).
 */
export async function buildWorkContractHtmlForEmailAdmin(
  db: Firestore,
  companyId: string,
  jobId: string,
  contractId: string
): Promise<BuildWorkContractHtmlForEmailResult> {
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(companyId);
  const jobRef = companyRef.collection("jobs").doc(jobId);
  const contractRef = jobRef.collection("workContracts").doc(contractId);

  log("load start", `companyId=${companyId} jobId=${jobId} contractId=${contractId}`);

  const [companySnap, jobSnap, contractSnap, contractsSnap, bankSnap] = await Promise.all([
    companyRef.get(),
    jobRef.get(),
    contractRef.get(),
    jobRef.collection("workContracts").get(),
    companyRef.collection("bankAccounts").get(),
  ]);

  if (!companySnap.exists) {
    return { ok: false, error: "Organizace nebyla nalezena.", detail: companyRef.path };
  }
  if (!jobSnap.exists) {
    return { ok: false, error: "Zakázka nebyla nalezena.", detail: jobRef.path };
  }
  if (!contractSnap.exists) {
    return { ok: false, error: "Smlouva nebyla nalezena.", detail: contractRef.path };
  }

  const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
  const jobData = (jobSnap.data() ?? {}) as Record<string, unknown>;
  const contractData = { id: contractSnap.id, ...(contractSnap.data() ?? {}) } as WorkContractDoc;

  const companyBankAccountNumber = companyRootBankAccountNumber(companyData);
  const companyNameFromDoc = String(companyData.companyName ?? companyData.name ?? "").trim();

  const bankAccounts: WorkContractBankAccountLike[] = bankSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  })) as WorkContractBankAccountLike[];

  const workContractsForJob: WorkContractDoc[] = contractsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  })) as WorkContractDoc[];

  const customerId = String(jobData.customerId ?? "").trim();
  let customer: Record<string, unknown> | null = null;
  if (customerId) {
    const cSnap = await companyRef.collection("customers").doc(customerId).get();
    if (cSnap.exists) {
      customer = { id: cSnap.id, ...(cSnap.data() ?? {}) } as Record<string, unknown>;
    }
  }

  const templateId = String(jobData.templateId ?? "").trim();
  let template: JobTemplate | null = null;
  if (templateId) {
    const tSnap = await companyRef.collection("jobTemplates").doc(templateId).get();
    if (tSnap.exists) {
      template = tSnap.data() as JobTemplate;
    }
  }

  const jobBudgetBreakdown = resolveJobBudgetFromFirestore(jobData);
  const jobBudgetKc = jobBudgetBreakdown?.budgetGross ?? null;

  const form = workContractDocToForm(contractData, companyBankAccountNumber);

  const isAttachment = form.documentRole === "attachment";
  const depErr = validateWorkContractDeposit({
    depositAmountStr: form.depositAmount,
    depositPercentStr: form.depositPercentage,
    budgetKc: jobBudgetKc,
  });
  if (depErr && !isAttachment) {
    log("validate deposit", `failed=${depErr}`);
    return {
      ok: false,
      error: depErr,
      detail: "validateWorkContractDeposit (server, same as PDF button)",
    };
  }

  const ctx: WorkContractPrintHtmlBuildContext = {
    companyDoc: companyData,
    companyNameFromDoc,
    companyBankAccountNumber,
    bankAccounts,
    customer,
    job: jobData,
    jobId,
    jobBudgetKc,
    template: template ?? undefined,
    workContractsForJob,
  };

  log(
    "context ready",
    `contractNo=${form.contractNumber || "(empty)"} jobBudgetKc=${jobBudgetKc ?? "null"} templateId=${templateId || "—"} customer=${customerId || "—"}`
  );

  try {
    const html = buildWorkContractPrintHtmlString(form, ctx);
    log("html built", `chars=${html.length}`);
    return { ok: true, html, form };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = errorStackFromUnknown(e) ?? serializeUnknownForLog(e);
    console.error(`${LOG} buildWorkContractPrintHtmlString FAILED`, {
      message: msg,
      stack: e instanceof Error ? e.stack : undefined,
      serialized: serializeUnknownForLog(e),
    });
    return { ok: false, error: msg, detail: stack };
  }
}
