/**
 * Schválení konkrétního obrázku / výkresu zákazníkem — pole na dokumentu ve složce nebo v legacy photos.
 */

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";

export type JobMediaApprovalStatus = "pending" | "approved" | "changes_requested";

const MAX_ADMIN_NOTE = 2000;
const MAX_CUSTOMER_COMMENT = 8000;

export type ParsedJobMediaApproval = {
  requiresCustomerApproval: boolean;
  approvalStatus: JobMediaApprovalStatus;
  approvalNoteFromAdmin: string;
  approvalRequestedAtMs: number | null;
  approvalRequestedBy: string | null;
  approvedAtMs: number | null;
  approvedBy: string | null;
  customerComment: string;
  customerCommentAtMs: number | null;
  customerCommentBy: string | null;
};

function toMs(t: unknown): number | null {
  if (t && typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t && typeof (t as { seconds?: number }).seconds === "number") {
    return (t as { seconds: number }).seconds * 1000;
  }
  return null;
}

export function parseJobMediaApproval(raw: Record<string, unknown> | null | undefined): ParsedJobMediaApproval {
  const requires = raw?.requiresCustomerApproval === true;
  const st = raw?.approvalStatus;
  const approvalStatus: JobMediaApprovalStatus =
    st === "approved" || st === "changes_requested" || st === "pending" ? st : "pending";
  const note =
    typeof raw?.approvalNoteFromAdmin === "string"
      ? raw.approvalNoteFromAdmin.trim().slice(0, MAX_ADMIN_NOTE)
      : "";
  return {
    requiresCustomerApproval: requires,
    approvalStatus,
    approvalNoteFromAdmin: note,
    approvalRequestedAtMs: toMs(raw?.approvalRequestedAt),
    approvalRequestedBy:
      typeof raw?.approvalRequestedBy === "string" && raw.approvalRequestedBy.trim()
        ? raw.approvalRequestedBy.trim()
        : null,
    approvedAtMs: toMs(raw?.approvedAt),
    approvedBy:
      typeof raw?.approvedBy === "string" && raw.approvedBy.trim() ? raw.approvedBy.trim() : null,
    customerComment:
      typeof raw?.customerComment === "string"
        ? raw.customerComment.trim().slice(0, MAX_CUSTOMER_COMMENT)
        : "",
    customerCommentAtMs: toMs(raw?.customerCommentAt),
    customerCommentBy:
      typeof raw?.customerCommentBy === "string" && raw.customerCommentBy.trim()
        ? raw.customerCommentBy.trim()
        : null,
  };
}

/** Položka v seznamu „Ke schválení“ u zákazníka (není dokončené schválení). */
export function isJobMediaAwaitingCustomerApproval(parsed: ParsedJobMediaApproval): boolean {
  if (!parsed.requiresCustomerApproval) return false;
  if (parsed.approvalStatus === "approved") return false;
  return true;
}

export function approvalStatusLabelCs(status: JobMediaApprovalStatus): string {
  switch (status) {
    case "approved":
      return "Schváleno";
    case "changes_requested":
      return "Požadavek na opravu";
    default:
      return "Čeká na schválení";
  }
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function normalizeAdminApprovalNote(text: string): string {
  return String(text ?? "")
    .trim()
    .slice(0, MAX_ADMIN_NOTE);
}

export function normalizeCustomerApprovalComment(text: string): string {
  return String(text ?? "")
    .trim()
    .slice(0, MAX_CUSTOMER_COMMENT);
}

export type JobMediaRef =
  | { kind: "folderImages"; folderId: string; imageId: string }
  | { kind: "photos"; photoId: string };

export function jobMediaDocumentRef(fs: Firestore, companyId: string, jobId: string, target: JobMediaRef) {
  if (target.kind === "photos") {
    return doc(fs, "companies", companyId, "jobs", jobId, "photos", target.photoId);
  }
  return doc(
    fs,
    "companies",
    companyId,
    "jobs",
    jobId,
    "folders",
    target.folderId,
    "images",
    target.imageId
  );
}

const MEDIA_APPROVAL_TASK_PREFIX = "media-approval-";

export function mediaApprovalTaskDocId(target: JobMediaRef): string {
  if (target.kind === "photos") {
    return `${MEDIA_APPROVAL_TASK_PREFIX}ph_${target.photoId.replace(/[/\\]/g, "_").slice(0, 120)}`;
  }
  return `${MEDIA_APPROVAL_TASK_PREFIX}fi_${target.folderId.replace(/[/\\]/g, "_")}_${target.imageId.replace(/[/\\]/g, "_")}`.slice(
    0,
    400
  );
}

/** Po označení ke schválení: úkol na portálu zákazníka (vidí ho v úkolech). */
export async function syncCustomerTaskForMediaApproval(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  assignedCustomerUid: string;
  adminUid: string;
  fileLabel: string;
  target: JobMediaRef;
  enabled: boolean;
}): Promise<void> {
  const {
    firestore,
    companyId,
    jobId,
    assignedCustomerUid,
    adminUid,
    fileLabel,
    target,
    enabled,
  } = params;
  const taskId = mediaApprovalTaskDocId(target);
  const taskRef = doc(
    firestore,
    "companies",
    companyId,
    "jobs",
    jobId,
    "customer_tasks",
    taskId
  );
  if (!enabled) {
    await setDoc(
      taskRef,
      stripUndefined({
        status: "completed",
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        description: "Požadavek na schválení byl stažen.",
      }),
      { merge: true }
    );
    return;
  }
  await setDoc(
    taskRef,
    stripUndefined({
      companyId,
      jobId,
      assignedCustomerUid,
      status: "pending",
      title: `Schválení dokumentu: ${fileLabel}`,
      description:
        "Na detailu zakázky najdete sekci „Ke schválení“. Prosím zkontrolujte výkres nebo dokument a potvrďte souhlas.",
      type: "custom",
      autoGenerated: true,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

export async function resolveCustomerPortalUidForJob(
  firestore: Firestore,
  companyId: string,
  job: Record<string, unknown>
): Promise<string | null> {
  const portalIds = Array.isArray(job.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim() !== ""
      )
    : [];
  if (portalIds[0]) return portalIds[0].trim();

  const crmId =
    typeof job.customerId === "string" && job.customerId.trim() ? job.customerId.trim() : "";
  if (crmId) {
    try {
      const cRef = doc(firestore, "companies", companyId, "customers", crmId);
      const snap = await getDoc(cRef);
      if (snap.exists()) {
        const uid = (snap.data() as { customerPortalUid?: string }).customerPortalUid;
        if (typeof uid === "string" && uid.trim()) return uid.trim();
      }
    } catch {
      /* */
    }
  }
  return null;
}
