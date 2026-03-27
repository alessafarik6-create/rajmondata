/**
 * Propojení primárního záznamu v companies/.../documents s nákladem zakázky
 * companies/.../jobs/.../expenses. Zrcadlo z nákladů (jobExpense_*) řeší job-expense-document-sync.
 */

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import type { CompanyDocumentLike } from "@/lib/company-documents-financial";
import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import { roundMoney2 } from "@/lib/vat-calculations";

export const COMPANY_DOCUMENT_EXPENSE_SOURCE = "company_document" as const;

type DocAmountInput = CompanyDocumentLike & {
  sDPH?: boolean;
  castka?: number;
  amountNet?: number;
  amountGross?: number;
  amount?: number;
  vatAmount?: number;
  dphSazba?: number;
  vatRate?: number;
  vat?: number;
};

function inferSDPH(row: DocAmountInput): boolean {
  if (typeof row.sDPH === "boolean") return row.sDPH;
  const va = Number(row.vatAmount ?? 0);
  const vr = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 0);
  return va > 0 || vr > 0;
}

/** Stejná logika jako docDisplayAmounts v sekci Doklady (včetně vlastní sazby DPH). */
export function companyDocumentExpenseAmounts(row: DocAmountInput): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  vatRatePercent: number;
} {
  const sDPH = inferSDPH(row);
  if (!sDPH) {
    const c = roundMoney2(
      Number(
        row.castka ?? row.amountNet ?? row.amountGross ?? row.amount ?? 0
      )
    );
    return { amountNet: c, vatAmount: 0, amountGross: c, vatRatePercent: 0 };
  }
  const rate = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  let net = roundMoney2(Number(row.amountNet ?? row.amount ?? 0));
  let gross = roundMoney2(Number(row.amountGross ?? 0));
  let vat = roundMoney2(Number(row.vatAmount ?? 0));
  if (gross <= 0 && net > 0 && Number.isFinite(rate)) {
    vat = roundMoney2((net * rate) / 100);
    gross = roundMoney2(net + vat);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (vat <= 0 && net > 0 && gross > 0) {
    vat = roundMoney2(gross - net);
  }
  const vatRatePercent = Number.isFinite(rate)
    ? Math.min(100, Math.max(0, Math.round(rate)))
    : 21;
  return {
    amountNet: net,
    vatAmount: vat,
    amountGross: gross,
    vatRatePercent,
  };
}

export function jobIdFromCompanyDocument(row: {
  jobId?: string | null;
  zakazkaId?: string | null;
}): string | null {
  const j = String(row.zakazkaId ?? row.jobId ?? "").trim();
  return j || null;
}

export function shouldLinkCompanyDocumentToJobExpense(
  row: DocAmountInput & {
    assignmentType?: string;
    jobId?: string | null;
    zakazkaId?: string | null;
    source?: string;
    sourceType?: string;
    type?: string;
    documentKind?: string;
  }
): boolean {
  if (row.source === JOB_EXPENSE_DOCUMENT_SOURCE || row.sourceType === "expense") {
    return false;
  }
  const isReceived =
    row.type === "received" || row.documentKind === "prijate";
  if (!isReceived) return false;
  if (row.assignmentType !== "job_cost") return false;
  if (!jobIdFromCompanyDocument(row)) return false;
  if (!isFinancialCompanyDocument(row)) return false;
  const { amountGross } = companyDocumentExpenseAmounts(row);
  return amountGross > 0;
}

export type CompanyDocumentExpenseReconcileBefore = DocAmountInput & {
  id?: string;
  linkedExpenseId?: string | null;
  assignmentType?: string;
  jobId?: string | null;
  zakazkaId?: string | null;
  jobName?: string | null;
  type?: string;
  documentKind?: string;
  number?: string;
  nazev?: string;
  entityName?: string;
  description?: string;
  note?: string | null;
  poznamka?: string | null;
  date?: string;
  fileUrl?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
};

/**
 * Po vytvoření / úpravě dokladu udrží jeden záznam v expenses a pole linkedExpenseId na dokladu.
 */
export async function reconcileCompanyDocumentJobExpense(params: {
  firestore: Firestore;
  companyId: string;
  userId: string;
  documentId: string;
  before: CompanyDocumentExpenseReconcileBefore | null;
  after: CompanyDocumentExpenseReconcileBefore;
}): Promise<void> {
  const { firestore, companyId, userId, documentId, before, after } = params;

  if (
    after.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
    after.sourceType === "expense"
  ) {
    return;
  }

  const prevId = before?.linkedExpenseId?.trim() || null;
  const prevJob = before ? jobIdFromCompanyDocument(before) : null;
  const prevActive =
    Boolean(
      prevId && prevJob && before && shouldLinkCompanyDocumentToJobExpense(before)
    );

  const nextJob = jobIdFromCompanyDocument(after);
  const nextActive = shouldLinkCompanyDocumentToJobExpense(after);

  const sameSeat =
    prevActive &&
    nextActive &&
    prevId === after.linkedExpenseId?.trim() &&
    prevJob === nextJob;

  if (prevActive && prevId && prevJob && !sameSeat) {
    await deleteExpenseDocIfExists(
      firestore,
      companyId,
      prevJob,
      prevId
    );
  }

  const docRef = doc(firestore, "companies", companyId, "documents", documentId);

  if (!nextActive) {
    if (after.linkedExpenseId || before?.linkedExpenseId) {
      await updateDoc(docRef, {
        linkedExpenseId: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
    return;
  }

  const amounts = companyDocumentExpenseAmounts(after);
  if (amounts.amountNet <= 0 || amounts.amountGross <= 0) {
    return;
  }

  const noteText =
    after.nazev?.trim() ||
    after.number?.trim() ||
    after.entityName?.trim() ||
    `Doklad ${documentId.slice(0, 8)}`;
  const dateStr =
    (after.date && String(after.date).trim()) ||
    new Date().toISOString().split("T")[0];

  const fileTypeRaw = after.fileType?.trim();
  const fileTypeNorm =
    fileTypeRaw === "image" || fileTypeRaw === "pdf" || fileTypeRaw === "office"
      ? fileTypeRaw
      : fileTypeRaw === "application"
        ? "pdf"
        : null;

  const commonExpense = {
    companyId,
    jobId: nextJob,
    amount: amounts.amountNet,
    amountNet: amounts.amountNet,
    amountGross: amounts.amountGross,
    vatRate: amounts.vatRatePercent,
    vatAmount: amounts.vatAmount,
    date: dateStr,
    note: noteText,
    dokladId: documentId,
    source: COMPANY_DOCUMENT_EXPENSE_SOURCE,
    fileUrl: after.fileUrl ?? null,
    fileType: fileTypeNorm,
    fileName: after.fileName ?? null,
    storagePath: after.storagePath ?? null,
    updatedAt: serverTimestamp(),
  };

  if (sameSeat && prevId && nextJob) {
    const expRef = doc(
      firestore,
      "companies",
      companyId,
      "jobs",
      nextJob,
      "expenses",
      prevId
    );
    await updateDoc(expRef, commonExpense);
    return;
  }

  const expCol = collection(
    firestore,
    "companies",
    companyId,
    "jobs",
    nextJob!,
    "expenses"
  );
  const expRef = doc(expCol);
  const batch = writeBatch(firestore);
  batch.set(expRef, {
    ...commonExpense,
    createdBy: userId,
    createdAt: serverTimestamp(),
  });
  batch.update(docRef, {
    linkedExpenseId: expRef.id,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

async function deleteExpenseDocIfExists(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  expenseId: string
): Promise<void> {
  const ref = doc(
    firestore,
    "companies",
    companyId,
    "jobs",
    jobId,
    "expenses",
    expenseId
  );
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) await deleteDoc(ref);
  } catch {
    /* */
  }
}
