/**
 * Synchronizace nákladů zakázky (jobs/.../expenses) s firemními doklady (companies/.../documents).
 * Jednoznačný párovací klíč: dokument v `documents` má id `jobExpense_{expenseId}` a pole `sourceId` = expenseId.
 */

import type { Firestore } from "firebase/firestore";
import { doc, serverTimestamp } from "firebase/firestore";
import type { JobBudgetType, VatRatePercent } from "@/lib/vat-calculations";

export const JOB_EXPENSE_DOCUMENT_SOURCE = "job-expense" as const;

/** ID dokumentu v `companies/{companyId}/documents/{docId}`. */
export function companyDocumentIdForJobExpense(expenseId: string): string {
  return `jobExpense_${expenseId}`;
}

export function companyDocumentRefForJobExpense(
  firestore: Firestore,
  companyId: string,
  expenseId: string
) {
  return doc(
    firestore,
    "companies",
    companyId,
    "documents",
    companyDocumentIdForJobExpense(expenseId)
  );
}

export type JobExpenseMirrorFirestoreFields = {
  /** Shodně s kartou „Přijaté doklady“ (existující filtr). */
  type: "received";
  /** Doplňkový štítek dle zadání (prijate). */
  documentKind: "prijate";
  source: typeof JOB_EXPENSE_DOCUMENT_SOURCE;
  /** Jednotná klasifikace: náklad zakázky = expense (viz také `source`). */
  sourceType: "expense";
  sourceId: string;
  sourceLabel: string;
  linkedExpenseId: string;
  jobId: string;
  jobName: string | null;
  /** Částka včetně DPH (hlavní částka v přehledu dokladů). */
  amount: number;
  /** Uživatelský vstup (stejně jako u nákladu v zakázce). */
  amountInput?: number;
  amountType?: JobBudgetType;
  amountNet: number;
  vatRate: VatRatePercent;
  vatAmount: number;
  amountGross: number;
  date: string;
  note: string | null;
  description: string;
  number: string;
  entityName: string;
  fileUrl: string | null;
  fileType: string | null;
  mimeType: string | null;
  fileName: string | null;
  storagePath: string | null;
  /** Sazba DPH v % (pole „vat“ v dokladech — kompatibilita s ručním zadáním). */
  vat: number;
  organizationId: string;
  createdBy: string;
  createdAt: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
};

export function buildNewJobExpenseMirrorDocument(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  expenseId: string;
  userId: string;
  amountInput: number;
  amountType: JobBudgetType;
  amountNet: number;
  vatRate: VatRatePercent;
  vatAmount: number;
  amountGross: number;
  date: string;
  note: string | null;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
  storagePath: string | null;
  mimeType?: string | null;
}): JobExpenseMirrorFirestoreFields {
  const note = params.note?.trim() ? params.note.trim() : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const ts = serverTimestamp();
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_EXPENSE_DOCUMENT_SOURCE,
    sourceType: "expense",
    sourceId: params.expenseId,
    sourceLabel: "Náklad zakázky",
    linkedExpenseId: params.expenseId,
    jobId: params.jobId,
    jobName: jn || null,
    amount: params.amountGross,
    amountInput: params.amountInput,
    amountType: params.amountType,
    amountNet: params.amountNet,
    vatRate: params.vatRate,
    vatAmount: params.vatAmount,
    amountGross: params.amountGross,
    date: params.date,
    note,
    description: note ?? "",
    number: `NK-${params.expenseId.slice(0, 12)}`,
    entityName: jn || "Zakázka",
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    mimeType: params.mimeType?.trim() ? params.mimeType.trim() : null,
    fileName: params.fileName,
    storagePath: params.storagePath,
    vat: params.vatRate,
    organizationId: params.companyId,
    createdBy: params.userId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Pola pro merge při úpravě nákladu (bez přepisu createdAt / createdBy). */
export function buildJobExpenseMirrorMergePatch(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  expenseId: string;
  amountInput: number;
  amountType: JobBudgetType;
  amountNet: number;
  vatRate: VatRatePercent;
  vatAmount: number;
  amountGross: number;
  date: string;
  note: string | null;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
  storagePath: string | null;
  mimeType?: string | null;
}): Record<string, unknown> {
  const note = params.note?.trim() ? params.note.trim() : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const patch: Record<string, unknown> = {
    type: "received",
    documentKind: "prijate",
    source: JOB_EXPENSE_DOCUMENT_SOURCE,
    sourceType: "expense",
    sourceId: params.expenseId,
    sourceLabel: "Náklad zakázky",
    linkedExpenseId: params.expenseId,
    jobId: params.jobId,
    jobName: jn || null,
    amount: params.amountGross,
    amountInput: params.amountInput,
    amountType: params.amountType,
    amountNet: params.amountNet,
    vatRate: params.vatRate,
    vatAmount: params.vatAmount,
    amountGross: params.amountGross,
    date: params.date,
    note,
    description: note ?? "",
    number: `NK-${params.expenseId.slice(0, 12)}`,
    entityName: jn || "Zakázka",
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    fileName: params.fileName,
    storagePath: params.storagePath,
    vat: params.vatRate,
    organizationId: params.companyId,
    updatedAt: serverTimestamp(),
  };
  if (params.mimeType !== undefined) {
    patch.mimeType = params.mimeType?.trim() ? params.mimeType.trim() : null;
  }
  return patch;
}
