/**
 * Účetní zápisy při nahrání souboru do složky typu „Doklady / účetní“.
 * Příjem: jobs/.../incomes/{imageId}, finance (revenue), increment paidAmount* na zakázce.
 * Náklad: jobs/.../expenses, companies/.../documents (mirror), finance (expense).
 */

import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  buildNewJobExpenseMirrorDocument,
  companyDocumentRefForJobExpense,
} from "@/lib/job-expense-document-sync";
import type { JobExpenseFileType } from "@/lib/job-expense-types";
import {
  computeExpenseAmountsFromInput,
  normalizeBudgetType,
  normalizeVatRate,
  roundMoney2,
  type JobBudgetType,
  type VatRatePercent,
} from "@/lib/vat-calculations";

export async function commitFolderAccountingIncome(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  userId: string;
  imageId: string;
  fileName: string;
  fileUrl: string;
  date: string;
  amountInput: number;
  amountType: JobBudgetType;
  vatRate: VatRatePercent;
}): Promise<{ financeId: string }> {
  const amountInputStored = roundMoney2(params.amountInput);
  const { amountNet, vatAmount, amountGross } = computeExpenseAmountsFromInput({
    amountInput: amountInputStored,
    amountType: params.amountType,
    vatRate: params.vatRate,
  });
  if (amountNet <= 0 || amountGross <= 0) {
    throw new Error("Neplatná částka.");
  }

  const incomeRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "incomes",
    params.imageId
  );
  const jobRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId
  );
  const financeRef = doc(
    collection(params.firestore, "companies", params.companyId, "finance")
  );

  await runTransaction(params.firestore, async (transaction) => {
    const incSnap = await transaction.get(incomeRef);
    if (incSnap.exists()) {
      throw new Error("Tento doklad je již zaúčtován (stejné ID souboru).");
    }
    const jobSnap = await transaction.get(jobRef);
    if (!jobSnap.exists()) {
      throw new Error("Zakázka neexistuje.");
    }

    transaction.set(incomeRef, {
      type: "income",
      companyId: params.companyId,
      jobId: params.jobId,
      imageId: params.imageId,
      amountInput: amountInputStored,
      amountType: params.amountType,
      amountNet,
      vatAmount,
      amountGross,
      vatRate: params.vatRate,
      date: params.date,
      fileName: params.fileName,
      fileUrl: params.fileUrl,
      financeId: financeRef.id,
      createdBy: params.userId,
      createdAt: serverTimestamp(),
    });

    transaction.update(jobRef, {
      paidAmountNet: increment(amountNet),
      paidAmountGross: increment(amountGross),
    });

    transaction.set(financeRef, {
      type: "revenue",
      amount: amountGross,
      amountNet,
      amountGross,
      vatRate: params.vatRate,
      vatAmount,
      date: params.date,
      description: `Úhrada zakázky – ${params.fileName}`,
      jobId: params.jobId,
      source: "job_folder_income",
      folderImageId: params.imageId,
      jobName: params.jobDisplayName?.trim() ?? "",
      createdAt: serverTimestamp(),
      createdBy: params.userId,
    });
  });

  return { financeId: financeRef.id };
}

export async function commitFolderAccountingExpense(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  userId: string;
  imageId: string;
  folderId: string;
  fileName: string;
  fileUrl: string;
  date: string;
  amountInput: number;
  amountType: JobBudgetType;
  vatRate: VatRatePercent;
  fileType: JobExpenseFileType;
  storagePath: string;
  mimeType: string | null;
}): Promise<{ expenseId: string; financeId: string }> {
  const amountInputStored = roundMoney2(params.amountInput);
  const amountTypeResolved = normalizeBudgetType(params.amountType);
  const vatRate = normalizeVatRate(params.vatRate);
  const { amountNet, vatAmount, amountGross } = computeExpenseAmountsFromInput({
    amountInput: amountInputStored,
    amountType: amountTypeResolved,
    vatRate,
  });
  if (amountNet <= 0 || amountGross <= 0) {
    throw new Error("Neplatná částka.");
  }

  const expensesCol = collection(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "expenses"
  );
  const expenseRef = doc(expensesCol);
  const mirrorRef = companyDocumentRefForJobExpense(
    params.firestore,
    params.companyId,
    expenseRef.id
  );
  const financeRef = doc(
    collection(params.firestore, "companies", params.companyId, "finance")
  );

  const expensePayload = {
    companyId: params.companyId,
    jobId: params.jobId,
    amount: amountNet,
    amountNet,
    vatRate,
    vatAmount,
    amountGross,
    date: params.date,
    note: `Doklad ve složce: ${params.fileName}`,
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    fileName: params.fileName,
    storagePath: params.storagePath,
    createdBy: params.userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: "folder_documents",
    folderId: params.folderId,
    folderImageId: params.imageId,
  };

  const mirrorDoc = buildNewJobExpenseMirrorDocument({
    companyId: params.companyId,
    jobId: params.jobId,
    jobDisplayName: params.jobDisplayName,
    expenseId: expenseRef.id,
    userId: params.userId,
    amountInput: amountInputStored,
    amountType: amountTypeResolved,
    amountNet,
    vatRate,
    vatAmount,
    amountGross,
    date: params.date,
    note: expensePayload.note,
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    fileName: params.fileName,
    storagePath: params.storagePath,
    mimeType: params.mimeType,
  });

  const batch = writeBatch(params.firestore);
  batch.set(expenseRef, expensePayload);
  batch.set(mirrorRef, mirrorDoc);
  batch.set(financeRef, {
    type: "expense",
    amount: amountGross,
    amountNet,
    amountGross,
    vatRate,
    vatAmount,
    date: params.date,
    description: `Náklad zakázky – ${params.fileName}`,
    jobId: params.jobId,
    source: "job_folder_expense",
    expenseId: expenseRef.id,
    folderImageId: params.imageId,
    createdAt: serverTimestamp(),
    createdBy: params.userId,
  });
  await batch.commit();

  return { expenseId: expenseRef.id, financeId: financeRef.id };
}

export async function reverseFolderAccountingIncome(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  imageId: string;
}): Promise<void> {
  const incomeRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "incomes",
    params.imageId
  );
  const jobRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId
  );

  await runTransaction(params.firestore, async (transaction) => {
    const incSnap = await transaction.get(incomeRef);
    if (!incSnap.exists()) return;
    const data = incSnap.data() as {
      amountNet?: unknown;
      amountGross?: unknown;
      financeId?: unknown;
    };
    const net = roundMoney2(Number(data.amountNet));
    const gross = roundMoney2(Number(data.amountGross));
    const financeId =
      typeof data.financeId === "string" && data.financeId
        ? data.financeId
        : null;

    transaction.delete(incomeRef);
    transaction.update(jobRef, {
      paidAmountNet: increment(-net),
      paidAmountGross: increment(-gross),
    });
    if (financeId) {
      const finRef = doc(
        params.firestore,
        "companies",
        params.companyId,
        "finance",
        financeId
      );
      transaction.delete(finRef);
    }
  });
}

export async function deleteFolderExpenseLinkedToImage(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  expenseId: string;
  financeId: string | null;
  storagePath?: string | null;
}): Promise<void> {
  const expenseRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "jobs",
    params.jobId,
    "expenses",
    params.expenseId
  );
  const mirrorRef = companyDocumentRefForJobExpense(
    params.firestore,
    params.companyId,
    params.expenseId
  );
  const batch = writeBatch(params.firestore);
  batch.delete(expenseRef);
  batch.delete(mirrorRef);
  if (params.financeId) {
    batch.delete(
      doc(
        params.firestore,
        "companies",
        params.companyId,
        "finance",
        params.financeId
      )
    );
  }
  await batch.commit();
}
