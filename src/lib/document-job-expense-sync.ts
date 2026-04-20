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
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import type { CompanyDocumentLike } from "@/lib/company-documents-financial";
import {
  allocationJobIdsFromRows,
  jobExpenseSlicesFromAllocations,
  normalizeJobCostAllocationRows,
  resolveJobCostAllocationsFromDocument,
} from "@/lib/company-document-job-allocations";
import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import { roundMoney2 } from "@/lib/vat-calculations";

export const COMPANY_DOCUMENT_EXPENSE_SOURCE = "company_document" as const;

type DocAmountInput = CompanyDocumentLike & {
  currency?: string;
  amountOriginal?: number;
  amountCZK?: number;
  exchangeRate?: number;
  sDPH?: boolean;
  castka?: number;
  castkaCZK?: number;
  amountNet?: number;
  amountGross?: number;
  amountNetCZK?: number;
  amountGrossCZK?: number;
  amount?: number;
  vatAmount?: number;
  vatAmountCZK?: number;
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
  const czkGrossRaw = Number(row.castkaCZK ?? row.amountGrossCZK ?? 0);
  const czkNetRaw = Number(row.amountNetCZK ?? 0);
  const useStoredCzk = czkGrossRaw > 0 || czkNetRaw > 0;
  /** Náklady zakázky v CZK — uložené přepočtené pole (EUR i nové CZK doklady). */
  if (useStoredCzk) {
    const sDPH = inferSDPH(row);
    const gross = roundMoney2(
      Number(row.castkaCZK ?? row.amountGrossCZK ?? 0)
    );
    if (!sDPH || gross <= 0) {
      const c = gross > 0 ? gross : roundMoney2(Number(row.castkaCZK ?? 0));
      return {
        amountNet: c,
        vatAmount: 0,
        amountGross: c,
        vatRatePercent: 0,
      };
    }
    const rate = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
    let net = roundMoney2(Number(row.amountNetCZK ?? row.amount ?? 0));
    let vat = roundMoney2(Number(row.vatAmountCZK ?? row.vatAmount ?? 0));
    let g = gross;
    if (g <= 0 && net > 0 && Number.isFinite(rate)) {
      vat = roundMoney2((net * rate) / 100);
      g = roundMoney2(net + vat);
    } else if (net <= 0 && g > 0 && Number.isFinite(rate) && rate > 0) {
      net = roundMoney2(g / (1 + rate / 100));
      vat = roundMoney2(g - net);
    } else if (net <= 0 && g > 0 && Number.isFinite(rate) && rate === 0) {
      net = g;
      vat = 0;
    } else if (vat <= 0 && net > 0 && g > 0) {
      vat = roundMoney2(g - net);
    }
    const vatRatePercent = Number.isFinite(rate)
      ? Math.min(100, Math.max(0, Math.round(rate)))
      : 21;
    return {
      amountNet: net,
      vatAmount: vat,
      amountGross: g,
      vatRatePercent,
    };
  }

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
  /** V Dokladech je hrubá částka často jen v `castka`; bez toho zůstane gross=0 a náklad se nevytvoří. */
  const castkaGross = roundMoney2(Number(row.castka ?? 0));
  if (gross <= 0 && castkaGross > 0) {
    gross = castkaGross;
  }
  if (gross <= 0 && net > 0 && Number.isFinite(rate)) {
    vat = roundMoney2((net * rate) / 100);
    gross = roundMoney2(net + vat);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate === 0) {
    net = gross;
    vat = 0;
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
  jobCostAllocations?: unknown;
  assignmentType?: string;
}): string | null {
  const { rows } = resolveJobCostAllocationsFromDocument(row);
  const firstJob = rows.find((r) => r.kind === "job" && r.jobId?.trim());
  if (firstJob?.jobId?.trim()) return firstJob.jobId.trim();
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
  /** Vydaný explicitně; ostatní (vč. legacy bez type/kind) bereme jako přijatý náklad. */
  const isReceived =
    row.type === "received" ||
    row.documentKind === "prijate" ||
    (row.type !== "issued" &&
      row.type !== "vydane" &&
      row.documentKind !== "vydane");
  if (!isReceived) return false;
  if (row.assignmentType !== "job_cost") return false;
  if (!isFinancialCompanyDocument(row)) return false;
  const castkaNum = Number(row.castka ?? 0);
  const { amountGross } = companyDocumentExpenseAmounts(row);
  if (!(castkaNum > 0 || amountGross > 0)) return false;
  const slices = jobExpenseSlicesFromAllocations(row as CompanyDocumentExpenseReconcileBefore)
    .slices;
  return slices.length > 0;
}

export type CompanyDocumentExpenseReconcileBefore = DocAmountInput & {
  id?: string;
  linkedExpenseId?: string | null;
  jobCostAllocations?: unknown;
  jobCostAllocationMode?: string;
  allocationJobIds?: string[];
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
  requiresPayment?: boolean;
  paid?: boolean;
  paymentStatus?: "unpaid" | "partial" | "paid" | null;
  paidAmount?: number | null;
  paidAt?: unknown;
  paymentMethod?: string | null;
  paymentNote?: string | null;
};

function collectExpenseIdsToRemoveBefore(
  before: CompanyDocumentExpenseReconcileBefore | null,
  afterSliceExpenseIds: Set<string>
): { jobId: string; expenseId: string }[] {
  if (!before) return [];
  const out: { jobId: string; expenseId: string }[] = [];
  const seen = new Set<string>();
  const slices = jobExpenseSlicesFromAllocations(before).slices;
  for (const s of slices) {
    if (!s.expenseId?.trim()) continue;
    const eid = s.expenseId.trim();
    if (seen.has(eid)) continue;
    seen.add(eid);
    if (!afterSliceExpenseIds.has(eid)) {
      out.push({ jobId: s.jobId, expenseId: eid });
    }
  }
  const legacyId = before.linkedExpenseId?.trim();
  const legacyJob = jobIdFromCompanyDocument(before);
  if (legacyId && legacyJob && !seen.has(legacyId) && !afterSliceExpenseIds.has(legacyId)) {
    out.push({ jobId: legacyJob, expenseId: legacyId });
  }
  return out;
}

/**
 * Po vytvoření / úpravě dokladu udrží záznamy v jobs/.../expenses (jeden nebo více při rozdělení).
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

  const docRef = doc(firestore, "companies", companyId, "documents", documentId);
  const nextActive = shouldLinkCompanyDocumentToJobExpense(after);
  const afterSlices = jobExpenseSlicesFromAllocations(after).slices;
  const afterIdsKept = new Set(
    afterSlices.map((s) => s.expenseId).filter(Boolean) as string[]
  );

  const toRemove = collectExpenseIdsToRemoveBefore(before, afterIdsKept);
  for (const t of toRemove) {
    await deleteExpenseDocIfExists(firestore, companyId, t.jobId, t.expenseId);
  }

  if (!nextActive) {
    const patch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (after.linkedExpenseId || before?.linkedExpenseId) {
      patch.linkedExpenseId = deleteField();
    }
    const clearedAlloc = normalizeJobCostAllocationRows(after.jobCostAllocations);
    if (clearedAlloc.length > 0) {
      patch.jobCostAllocations = clearedAlloc.map((r) => ({
        ...r,
        linkedExpenseId: null,
      }));
    }
    await updateDoc(docRef, patch as UpdateData<DocumentData>);
    return;
  }

  let amounts = companyDocumentExpenseAmounts(after);
  if (amounts.amountGross <= 0) {
    return;
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
  if (amountNet <= 0) {
    return;
  }

  const noteBase =
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

  const allocInfo = jobExpenseSlicesFromAllocations(after);
  const rowNoteById = new Map(
    allocInfo.rows.map((r) => [r.id, r.note?.trim() || ""])
  );

  function netVatFromGrossSlice(grossSlice: number): {
    net: number;
    vat: number;
    gross: number;
  } {
    const g = roundMoney2(grossSlice);
    if (g <= 0) return { net: 0, vat: 0, gross: 0 };
    if (!Number.isFinite(vr) || vr <= 0) {
      return { net: g, vat: 0, gross: g };
    }
    const net = roundMoney2(g / (1 + vr / 100));
    const vat = roundMoney2(g - net);
    if (net <= 0) return { net: g, vat: 0, gross: g };
    return { net, vat, gross: g };
  }

  const rowIdToExpenseId = new Map<string, string>();
  const beforeExpenseJobById = new Map<string, string>();
  if (before) {
    for (const s of jobExpenseSlicesFromAllocations(before).slices) {
      if (s.expenseId?.trim()) {
        beforeExpenseJobById.set(s.expenseId.trim(), s.jobId);
      }
    }
    const leg = before.linkedExpenseId?.trim();
    const lj = jobIdFromCompanyDocument(before);
    if (leg && lj && !beforeExpenseJobById.has(leg)) {
      beforeExpenseJobById.set(leg, lj);
    }
  }

  for (const slice of afterSlices) {
    const { net, vat, gross } = netVatFromGrossSlice(slice.grossCzk);
    if (net <= 0) continue;
    const rowNote = rowNoteById.get(slice.rowId) || "";
    const noteText = rowNote ? `${noteBase} · ${rowNote}` : noteBase;

    const commonExpense = {
      companyId,
      jobId: slice.jobId,
      amount: net,
      amountNet: net,
      amountGross: gross,
      vatRate: amounts.vatRatePercent,
      vatAmount: vat,
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

    const existingId = slice.expenseId?.trim() || null;
    if (existingId) {
      const expRef = doc(
        firestore,
        "companies",
        companyId,
        "jobs",
        slice.jobId,
        "expenses",
        existingId
      );
      const snap = await getDoc(expRef);
      if (snap.exists()) {
        await updateDoc(expRef, commonExpense);
        rowIdToExpenseId.set(slice.rowId, existingId);
        continue;
      }
      const prevJobForId = beforeExpenseJobById.get(existingId);
      if (prevJobForId && prevJobForId !== slice.jobId) {
        await deleteExpenseDocIfExists(
          firestore,
          companyId,
          prevJobForId,
          existingId
        );
      }
    }

    const expCol = collection(
      firestore,
      "companies",
      companyId,
      "jobs",
      slice.jobId,
      "expenses"
    );
    const expRef = doc(expCol);
    const batch = writeBatch(firestore);
    batch.set(expRef, {
      ...commonExpense,
      createdBy: userId,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    rowIdToExpenseId.set(slice.rowId, expRef.id);
  }

  const firstLinked = afterSlices.length ? rowIdToExpenseId.get(afterSlices[0].rowId) : null;
  const allocRowsRaw = normalizeJobCostAllocationRows(after.jobCostAllocations);
  const patchedAlloc =
    allocRowsRaw.length > 0
      ? allocRowsRaw.map((r) => ({
          ...r,
          linkedExpenseId: rowIdToExpenseId.get(r.id) ?? r.linkedExpenseId ?? null,
        }))
      : null;

  const docPatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    allocationJobIds: allocationJobIdsFromRows(allocInfo.rows),
  };
  if (firstLinked) {
    docPatch.linkedExpenseId = firstLinked;
  } else {
    docPatch.linkedExpenseId = deleteField();
  }
  if (patchedAlloc) {
    docPatch.jobCostAllocations = patchedAlloc;
  }
  await updateDoc(docRef, docPatch as UpdateData<DocumentData>);
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
