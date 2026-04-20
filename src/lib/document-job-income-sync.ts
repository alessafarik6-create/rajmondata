/**
 * Vydané doklady v companies/.../documents → příjem zakázky (jobs/.../incomes)
 * a započtení do paidAmountNet / paidAmountGross na dokumentu zakázky (stejně jako u příjmů ze složky).
 */

import {
  deleteField,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentSnapshot,
  type Firestore,
} from "firebase/firestore";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  companyDocumentExpenseAmounts,
  jobIdFromCompanyDocument,
} from "@/lib/document-job-expense-sync";
import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import {
  normalizeBudgetType,
  normalizeVatRate,
  roundMoney2,
  type JobBudgetType,
  type VatRatePercent,
} from "@/lib/vat-calculations";

export const COMPANY_DOCUMENT_INCOME_SOURCE = "company_document" as const;

export type CompanyDocumentIncomeReconcileBefore = {
  id?: string;
  assignmentType?: string;
  jobId?: string | null;
  zakazkaId?: string | null;
  jobName?: string | null;
  type?: string;
  documentKind?: string;
  source?: string;
  sourceType?: string;
  number?: string;
  nazev?: string;
  entityName?: string;
  description?: string;
  note?: string | null;
  poznamka?: string | null;
  date?: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  requiresPayment?: boolean;
  paid?: boolean;
  paymentStatus?: "unpaid" | "partial" | "paid" | null;
  paidAmount?: number | null;
  paidAt?: unknown;
  paymentMethod?: string | null;
  paymentNote?: string | null;
  castka?: number;
  castkaCZK?: number;
  amountNet?: number;
  amountGross?: number;
  amountNetCZK?: number;
  amountGrossCZK?: number;
  vatAmount?: number;
  vatAmountCZK?: number;
  amount?: number;
  vatRate?: number;
  dphSazba?: number;
  vat?: number;
  sDPH?: boolean;
  amountInput?: number;
  amountType?: unknown;
  currency?: string;
};

export function isIssuedCompanyDocument(row: {
  type?: string;
  documentKind?: string;
}): boolean {
  return (
    row.type === "issued" ||
    row.type === "vydane" ||
    row.documentKind === "vydane"
  );
}

export function shouldLinkCompanyDocumentToJobIncome(
  row: CompanyDocumentIncomeReconcileBefore
): boolean {
  if (
    row.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
    row.sourceType === "expense"
  ) {
    return false;
  }
  if (!isIssuedCompanyDocument(row)) return false;
  if (row.assignmentType !== "job_cost") return false;
  if (!jobIdFromCompanyDocument(row)) return false;
  if (!isFinancialCompanyDocument(row)) return false;
  const castkaNum = Number(row.castka ?? 0);
  const { amountGross } = companyDocumentExpenseAmounts(row);
  return castkaNum > 0 || amountGross > 0;
}

/**
 * Úhrada vůči rozpočtu zakázky: faktury k úhradě počítáme až po označení zaplaceno;
 * doklady bez „k úhradě“ bereme jako již přijatý příjem.
 */
export function issuedDocumentCountsTowardJobPaid(row: {
  requiresPayment?: boolean;
  paid?: boolean;
}): boolean {
  if (row.requiresPayment === true) return row.paid === true;
  return true;
}

function resolveIncomeAmounts(
  after: CompanyDocumentIncomeReconcileBefore
): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  vatRatePercent: number;
} {
  let amounts = companyDocumentExpenseAmounts(after);
  if (amounts.amountGross <= 0) {
    return amounts;
  }
  let amountNet = amounts.amountNet;
  let vatAmt = amounts.vatAmount;
  const vr = amounts.vatRatePercent;
  if (amountNet <= 0 && amounts.amountGross > 0) {
    if (!Number.isFinite(vr) || vr <= 0) {
      amountNet = amounts.amountGross;
      vatAmt = 0;
    } else {
      amountNet = roundMoney2(amounts.amountGross / (1 + vr / 100));
      vatAmt = roundMoney2(amounts.amountGross - amountNet);
    }
    amounts = {
      ...amounts,
      amountNet,
      vatAmount: vatAmt,
      amountGross: amounts.amountGross,
    };
  }
  return amounts;
}

function incomeDisplayTitle(after: CompanyDocumentIncomeReconcileBefore): string {
  return (
    after.number?.trim() ||
    after.nazev?.trim() ||
    after.entityName?.trim() ||
    after.description?.trim() ||
    ""
  );
}

/**
 * Drží jeden záznam v jobs/.../incomes/{documentId} a synchronizuje paidAmount* na zakázce.
 */
export async function reconcileCompanyDocumentJobIncome(params: {
  firestore: Firestore;
  companyId: string;
  userId: string;
  documentId: string;
  before: CompanyDocumentIncomeReconcileBefore | null;
  after: CompanyDocumentIncomeReconcileBefore;
}): Promise<void> {
  const { firestore, companyId, userId, documentId, before, after } = params;

  if (
    after.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
    after.sourceType === "expense"
  ) {
    return;
  }

  const prevLinkedIncome = Boolean(
    before && shouldLinkCompanyDocumentToJobIncome(before)
  );
  const nextLinkedIncome = shouldLinkCompanyDocumentToJobIncome(after);
  if (!prevLinkedIncome && !nextLinkedIncome) {
    return;
  }

  const prevJob = before ? jobIdFromCompanyDocument(before) : null;
  const prevActive = prevLinkedIncome;
  const nextJob = jobIdFromCompanyDocument(after);
  const nextActive = nextLinkedIncome;

  const sameSeat =
    prevActive &&
    nextActive &&
    prevJob &&
    nextJob &&
    prevJob === nextJob;

  const docRef = doc(
    firestore,
    "companies",
    companyId,
    "documents",
    documentId
  );

  const removeFromPrev =
    prevActive && prevJob && (!nextActive || prevJob !== nextJob);

  await runTransaction(firestore, async (transaction) => {
    const prevIncomeRef =
      prevJob && removeFromPrev
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            prevJob,
            "incomes",
            documentId
          )
        : null;

    const nextIncomeRef =
      nextActive && nextJob
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            nextJob,
            "incomes",
            documentId
          )
        : null;

    let prevSnap: DocumentSnapshot | null = null;
    let nextSnap: DocumentSnapshot | null = null;

    if (prevIncomeRef) {
      prevSnap = await transaction.get(prevIncomeRef);
    }
    if (nextIncomeRef) {
      nextSnap = await transaction.get(nextIncomeRef);
    }

    const jobRef =
      nextActive && nextJob
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            nextJob
          )
        : null;
    let jobSnap: DocumentSnapshot | null = null;
    if (jobRef) {
      jobSnap = await transaction.get(jobRef);
    }

    if (prevIncomeRef && removeFromPrev && prevSnap?.exists()) {
      const d = prevSnap.data() as {
        appliedPaidNet?: unknown;
        appliedPaidGross?: unknown;
      };
      const subNet = roundMoney2(Number(d.appliedPaidNet ?? 0));
      const subGross = roundMoney2(Number(d.appliedPaidGross ?? 0));
      if (subNet !== 0 || subGross !== 0) {
        const prevJobRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          prevJob!
        );
        transaction.update(prevJobRef, {
          paidAmountNet: increment(-subNet),
          paidAmountGross: increment(-subGross),
        });
      }
      transaction.delete(prevIncomeRef);
    }

    if (!nextActive) {
      transaction.update(docRef, {
        linkedIncomeId: deleteField(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (!jobRef || !jobSnap?.exists()) {
      throw new Error("Zakázka pro příjem z dokladu neexistuje.");
    }

    const amounts = resolveIncomeAmounts(after);
    if (amounts.amountNet <= 0 || amounts.amountGross <= 0) {
      transaction.update(docRef, {
        linkedIncomeId: deleteField(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const countsPaid = issuedDocumentCountsTowardJobPaid(after);
    const appliedNet = countsPaid ? roundMoney2(amounts.amountNet) : 0;
    const appliedGross = countsPaid ? roundMoney2(amounts.amountGross) : 0;

    const dateStr =
      (after.date && String(after.date).trim()) ||
      new Date().toISOString().split("T")[0];

    const title = incomeDisplayTitle(after);
    const fileName =
      after.fileName?.trim() ||
      title ||
      after.number?.trim() ||
      `Doklad ${documentId.slice(0, 8)}`;

    const amountType = normalizeBudgetType(after.amountType) as JobBudgetType;
    const vatRate = normalizeVatRate(
      after.dphSazba ?? after.vatRate ?? after.vat
    ) as VatRatePercent;

    const nextIncomeRefResolved = doc(
      firestore,
      "companies",
      companyId,
      "jobs",
      nextJob!,
      "incomes",
      documentId
    );

    if (sameSeat) {
      const snap = nextSnap;
      const oldAppliedNet = snap?.exists()
        ? roundMoney2(Number((snap.data() as { appliedPaidNet?: unknown }).appliedPaidNet ?? 0))
        : 0;
      const oldAppliedGross = snap?.exists()
        ? roundMoney2(
            Number(
              (snap.data() as { appliedPaidGross?: unknown }).appliedPaidGross ??
                0
            )
          )
        : 0;

      const dNet = roundMoney2(appliedNet - oldAppliedNet);
      const dGross = roundMoney2(appliedGross - oldAppliedGross);

      const existing = snap?.exists() ? snap.data() : null;
      const createdAt =
        (existing as { createdAt?: unknown } | null)?.createdAt ??
        serverTimestamp();
      const createdBy =
        (existing as { createdBy?: string } | null)?.createdBy ?? userId;

      transaction.set(nextIncomeRefResolved, {
        type: "income",
        source: COMPANY_DOCUMENT_INCOME_SOURCE,
        companyId,
        jobId: nextJob,
        companyDocumentId: documentId,
        imageId: documentId,
        number: after.number?.trim() || null,
        amountInput: roundMoney2(Number(after.amountInput ?? amounts.amountNet)),
        amountType,
        amountNet: amounts.amountNet,
        vatAmount: amounts.vatAmount,
        amountGross: amounts.amountGross,
        vatRate,
        date: dateStr,
        fileName,
        fileUrl: after.fileUrl ?? null,
        appliedPaidNet: appliedNet,
        appliedPaidGross: appliedGross,
        countsTowardJobPaid: countsPaid,
        createdBy,
        createdAt,
        updatedAt: serverTimestamp(),
      });

      if (dNet !== 0 || dGross !== 0) {
        transaction.update(jobRef, {
          paidAmountNet: increment(dNet),
          paidAmountGross: increment(dGross),
        });
      }

      transaction.update(docRef, {
        linkedIncomeId: documentId,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (!sameSeat && nextSnap?.exists()) {
      const orphan = nextSnap.data() as {
        appliedPaidNet?: unknown;
        appliedPaidGross?: unknown;
      };
      const oNet = roundMoney2(Number(orphan.appliedPaidNet ?? 0));
      const oGross = roundMoney2(Number(orphan.appliedPaidGross ?? 0));
      if (oNet !== 0 || oGross !== 0) {
        transaction.update(jobRef, {
          paidAmountNet: increment(-oNet),
          paidAmountGross: increment(-oGross),
        });
      }
      transaction.delete(nextIncomeRefResolved);
    }

    transaction.set(nextIncomeRefResolved, {
      type: "income",
      source: COMPANY_DOCUMENT_INCOME_SOURCE,
      companyId,
      jobId: nextJob,
      companyDocumentId: documentId,
      imageId: documentId,
      number: after.number?.trim() || null,
      amountInput: roundMoney2(Number(after.amountInput ?? amounts.amountNet)),
      amountType,
      amountNet: amounts.amountNet,
      vatAmount: amounts.vatAmount,
      amountGross: amounts.amountGross,
      vatRate,
      date: dateStr,
      fileName,
      fileUrl: after.fileUrl ?? null,
      appliedPaidNet: appliedNet,
      appliedPaidGross: appliedGross,
      countsTowardJobPaid: countsPaid,
      createdBy: userId,
      createdAt: serverTimestamp(),
    });

    transaction.update(jobRef, {
      paidAmountNet: increment(appliedNet),
      paidAmountGross: increment(appliedGross),
    });

    transaction.update(docRef, {
      linkedIncomeId: documentId,
      updatedAt: serverTimestamp(),
    });
  });
}
