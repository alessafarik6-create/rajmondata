import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { FieldValue, Timestamp as AdminTimestamp } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { isCompanyPrivileged } from "@/lib/company-privilege";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import type { LeadReminderRecord, LeadReminderStatus } from "@/lib/leads/lead-reminder-types";

function tsToIso(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  if ("toDate" in v && typeof (v as Timestamp).toDate === "function") {
    const d = (v as Timestamp).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function serializeLeadReminder(id: string, data: Record<string, unknown>): LeadReminderRecord {
  return {
    id,
    companyId: String(data.companyId ?? ""),
    organizationId: String(data.organizationId ?? data.companyId ?? ""),
    leadKey: String(data.leadKey ?? ""),
    importLeadId: String(data.importLeadId ?? ""),
    customerName: String(data.customerName ?? ""),
    inquiryTitle: String(data.inquiryTitle ?? ""),
    assignedUserId: String(data.assignedUserId ?? ""),
    assignedDisplayName:
      typeof data.assignedDisplayName === "string" ? data.assignedDisplayName : null,
    note: String(data.note ?? ""),
    remindAt: tsToIso(data.remindAt) ?? "",
    status: (data.status === "done" ? "done" : "active") as LeadReminderStatus,
    notificationFired: data.notificationFired === true,
    firedAt: tsToIso(data.firedAt),
    createdBy: String(data.createdBy ?? ""),
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    completedAt: tsToIso(data.completedAt),
  };
}

export function assertLeadReminderAssigneeOk(
  caller: VerifiedCompanyCaller,
  assignedUserId: string
): { ok: true } | { ok: false; error: string } {
  const target = String(assignedUserId ?? "").trim();
  if (!target) return { ok: false, error: "Chybí přiřazený uživatel." };
  if (target === caller.uid) return { ok: true };
  if (isCompanyPrivileged(caller.role, caller.globalRoles)) return { ok: true };
  return { ok: false, error: "Připomínku můžete nastavit jen sobě." };
}

export async function resolveEmployeeDisplayNameByAuthUid(
  db: Firestore,
  companyId: string,
  authUid: string
): Promise<string | null> {
  const qs = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees")
    .where("authUserId", "==", authUid)
    .limit(1)
    .get();
  if (!qs.empty) {
    const name = String(qs.docs[0].data()?.displayName ?? qs.docs[0].data()?.name ?? "").trim();
    if (name) return name;
  }
  const qs2 = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees")
    .where("userId", "==", authUid)
    .limit(1)
    .get();
  if (!qs2.empty) {
    const name = String(qs2.docs[0].data()?.displayName ?? qs2.docs[0].data()?.name ?? "").trim();
    if (name) return name;
  }
  const userSnap = await db.collection("users").doc(authUid).get();
  const u = userSnap.data();
  const fromUser = String(u?.displayName ?? u?.email ?? "").trim();
  return fromUser || null;
}

export type CreateLeadReminderInput = {
  leadKey: string;
  importLeadId: string;
  customerName: string;
  inquiryTitle: string;
  assignedUserId: string;
  note: string;
  remindAt: Date;
};

export async function createLeadReminderDoc(
  db: Firestore,
  companyId: string,
  caller: VerifiedCompanyCaller,
  input: CreateLeadReminderInput
): Promise<{ id: string }> {
  const assignCheck = assertLeadReminderAssigneeOk(caller, input.assignedUserId);
  if (!assignCheck.ok) throw new Error(assignCheck.error);

  const displayName = await resolveEmployeeDisplayNameByAuthUid(
    db,
    companyId,
    input.assignedUserId
  );

  const ref = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION)
    .add({
      companyId,
      organizationId: companyId,
      leadKey: input.leadKey,
      importLeadId: input.importLeadId,
      customerName: input.customerName.slice(0, 300),
      inquiryTitle: input.inquiryTitle.slice(0, 300),
      assignedUserId: input.assignedUserId,
      assignedDisplayName: displayName,
      note: input.note.slice(0, 2000),
      remindAt: AdminTimestamp.fromDate(input.remindAt),
      status: "active",
      notificationFired: false,
      firedAt: null,
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

  return { id: ref.id };
}
