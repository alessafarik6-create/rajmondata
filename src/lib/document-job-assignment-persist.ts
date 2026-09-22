import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";
import {
  allocationJobIdsFromRows,
  allocationsMirrorForDocument,
  type JobCostAllocationAmountBasis,
  type JobCostAllocationMode,
  type JobCostAllocationRow,
} from "@/lib/company-document-job-allocations";
import {
  reconcileCompanyDocumentJobExpense,
  type CompanyDocumentExpenseReconcileBefore,
} from "@/lib/document-job-expense-sync";
import { reconcileCompanyDocumentJobIncome } from "@/lib/document-job-income-sync";
import type { CompanyDocumentEditAssignmentType } from "@/lib/company-document-assignment";

export async function logDocumentAssignmentAudit(
  firestore: Firestore,
  companyId: string,
  params: {
    userId: string;
    documentId: string;
    actionType:
      | "DOCUMENT_ASSIGNED_TO_JOB"
      | "DOCUMENT_ASSIGNMENT_UPDATED"
      | "DOCUMENT_ASSIGNMENT_REMOVED"
      | "DOCUMENT_SPLIT_BETWEEN_JOBS";
    oldAssignments?: unknown;
    newAssignments?: unknown;
    jobIds?: string[];
  }
): Promise<void> {
  try {
    await addDoc(collection(firestore, "companies", companyId, "activityLogs"), {
      organizationId: companyId,
      companyId,
      userId: params.userId,
      actionType: params.actionType,
      actionLabel: params.actionType,
      entityType: "document",
      entityId: params.documentId,
      metadata: {
        jobIds: params.jobIds ?? [],
        oldAssignments: params.oldAssignments ?? null,
        newAssignments: params.newAssignments ?? null,
      },
      createdAt: serverTimestamp(),
    });
  } catch {
    /* audit must not block save */
  }
}

export async function persistDocumentJobAllocations(params: {
  firestore: Firestore;
  companyId: string;
  userId: string;
  documentId: string;
  mode: JobCostAllocationMode;
  amountBasis: JobCostAllocationAmountBasis;
  rows: JobCostAllocationRow[];
  /** null = vyčistit rozdělení, ponechat pending */
  clearToPending?: boolean;
  jobDisplayName?: string | null;
}): Promise<void> {
  const docRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "documents",
    params.documentId
  );
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const before = {
    ...(snap.data() as CompanyDocumentExpenseReconcileBefore),
    id: params.documentId,
  };
  const oldAssignments = before.jobCostAllocations ?? null;

  const domainRows = params.rows.filter((r) => {
    if (r.kind === "overhead") return true;
    if (r.kind !== "job" || !r.jobId?.trim()) return false;
    if (params.mode === "percent") {
      return Number(r.percent ?? 0) > 0;
    }
    return Number(r.amount ?? 0) > 0;
  });
  const hasJob = domainRows.some((r) => r.kind === "job" && r.jobId?.trim());
  const firstJob = domainRows.find((r) => r.kind === "job" && r.jobId?.trim());

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    jobCostAllocationAmountBasis: params.amountBasis,
  };

  if (!hasJob && params.clearToPending) {
    patch.assignmentType = "pending_assignment";
    patch.jobId = null;
    patch.zakazkaId = null;
    patch.jobName = null;
    patch.jobCostAllocations = deleteField();
    patch.jobCostAllocationMode = deleteField();
    patch.allocations = deleteField();
    patch.allocationMode = deleteField();
    patch.allocationJobIds = deleteField();
    patch.assignedTo = { jobId: null, companyId: null, warehouseId: null };
  } else if (hasJob) {
    const jid = firstJob!.jobId!.trim();
    patch.assignmentType = "job_cost";
    patch.jobId = jid;
    patch.zakazkaId = jid;
    patch.jobName = params.jobDisplayName?.trim() || null;
    patch.jobCostAllocations = domainRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      jobId: r.jobId,
      amount: r.amount ?? null,
      percent: r.percent ?? null,
      note: r.note ?? null,
      linkedExpenseId: r.linkedExpenseId ?? null,
    }));
    patch.jobCostAllocationMode = params.mode;
    patch.allocationMode = params.mode;
    patch.allocations = allocationsMirrorForDocument(domainRows);
    patch.allocationJobIds = allocationJobIdsFromRows(domainRows);
    patch.assignedTo = { jobId: jid, companyId: null, warehouseId: null };
  }

  await updateDoc(docRef, patch as UpdateData<DocumentData>);

  const afterSnap = await getDoc(docRef);
  const after = {
    ...(afterSnap.data() as CompanyDocumentExpenseReconcileBefore),
    id: params.documentId,
  };

  const actionType =
    domainRows.filter((r) => r.kind === "job").length > 1
      ? "DOCUMENT_SPLIT_BETWEEN_JOBS"
      : oldAssignments
        ? "DOCUMENT_ASSIGNMENT_UPDATED"
        : "DOCUMENT_ASSIGNED_TO_JOB";

  await logDocumentAssignmentAudit(params.firestore, params.companyId, {
    userId: params.userId,
    documentId: params.documentId,
    actionType,
    oldAssignments,
    newAssignments: patch.jobCostAllocations ?? null,
    jobIds: allocationJobIdsFromRows(domainRows),
  });

  await reconcileCompanyDocumentJobExpense({
    firestore: params.firestore,
    companyId: params.companyId,
    userId: params.userId,
    documentId: params.documentId,
    before,
    after,
  });
  await reconcileCompanyDocumentJobIncome({
    firestore: params.firestore,
    companyId: params.companyId,
    userId: params.userId,
    documentId: params.documentId,
    before,
    after,
  });
}

export async function persistDocumentNonJobAssignment(params: {
  firestore: Firestore;
  companyId: string;
  userId: string;
  documentId: string;
  assignmentType: CompanyDocumentEditAssignmentType;
  jobName?: string | null;
  selectedJobId?: string | null;
}): Promise<void> {
  const docRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "documents",
    params.documentId
  );
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error("Doklad neexistuje.");
  const before = {
    ...(snap.data() as CompanyDocumentExpenseReconcileBefore),
    id: params.documentId,
  };
  const oldAssignments = before.jobCostAllocations ?? null;
  const assignType = params.assignmentType;
  const jid =
    assignType === "job_cost" ? params.selectedJobId?.trim() || null : null;
  const patch: Record<string, unknown> = {
    assignmentType: assignType,
    jobId: jid,
    zakazkaId: jid,
    jobName: assignType === "job_cost" ? params.jobName ?? null : null,
    assignedTo: {
      jobId: assignType === "job_cost" ? jid : null,
      companyId: assignType === "company" ? params.companyId : null,
      warehouseId: assignType === "warehouse" ? "main" : null,
    },
    jobCostAllocations: deleteField(),
    jobCostAllocationMode: deleteField(),
    jobCostAllocationAmountBasis: deleteField(),
    allocations: deleteField(),
    allocationMode: deleteField(),
    allocationJobIds: deleteField(),
    updatedAt: serverTimestamp(),
  };
  await updateDoc(docRef, patch as UpdateData<DocumentData>);
  await logDocumentAssignmentAudit(params.firestore, params.companyId, {
    userId: params.userId,
    documentId: params.documentId,
    actionType: oldAssignments
      ? "DOCUMENT_ASSIGNMENT_REMOVED"
      : "DOCUMENT_ASSIGNMENT_UPDATED",
    oldAssignments,
    newAssignments: null,
    jobIds: jid ? [jid] : [],
  });
  const afterSnap = await getDoc(docRef);
  const after = {
    ...(afterSnap.data() as CompanyDocumentExpenseReconcileBefore),
    id: params.documentId,
  };
  await reconcileCompanyDocumentJobExpense({
    firestore: params.firestore,
    companyId: params.companyId,
    userId: params.userId,
    documentId: params.documentId,
    before,
    after,
  });
  await reconcileCompanyDocumentJobIncome({
    firestore: params.firestore,
    companyId: params.companyId,
    userId: params.userId,
    documentId: params.documentId,
    before,
    after,
  });
}
