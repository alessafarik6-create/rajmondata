import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  memberPermissionsForAccessMode,
  type JobAccessMode,
} from "@/lib/job-employee-access";

export async function assignEmployeesToJobAdmin(
  db: Firestore,
  companyId: string,
  jobId: string,
  jobRecord: Record<string, unknown>,
  employeeIds: string[],
  updatedByUid: string,
  accessMode: JobAccessMode = "limited"
): Promise<string[]> {
  const authUserIds: string[] = [];
  const perms = memberPermissionsForAccessMode(accessMode);
  const assignedAt = new Date().toISOString();

  for (const employeeId of employeeIds) {
    const eid = String(employeeId ?? "").trim();
    if (!eid) continue;
    const empSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("employees")
      .doc(eid)
      .get();
    if (!empSnap.exists) continue;
    const emp = empSnap.data() as Record<string, unknown>;
    if (emp.isActive === false || emp.active === false || emp.archived === true) continue;
    const authUserId = String(emp.authUserId ?? "").trim();

    await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("jobMembers")
      .doc(eid)
      .set(
        {
          employeeId: eid,
          authUserId: authUserId || null,
          roleOnJob: "montaznik",
          accessMode,
          jobPermissions: perms,
          assignedAt,
          isJobLead: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: updatedByUid,
        },
        { merge: true }
      );

    await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("employees")
      .doc(eid)
      .set(
        {
          assignedJobIds: FieldValue.arrayUnion(jobId),
          assignedWorklogJobIds: FieldValue.arrayUnion(jobId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    const jobName =
      String(jobRecord.name ?? "").trim() || String(jobRecord.title ?? "").trim() || jobId;
    const jobRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId);
    const patch: Record<string, unknown> = {
      assignedEmployeeIds: authUserId
        ? FieldValue.arrayUnion(eid, authUserId)
        : FieldValue.arrayUnion(eid),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await jobRef.update(patch);
    if (authUserId) authUserIds.push(authUserId);
  }

  return [...new Set(authUserIds)];
}

export async function addJobNoteCommentAdmin(
  db: Firestore,
  companyId: string,
  jobId: string,
  message: string,
  authorUid: string,
  authorName: string,
  authorRole: string
): Promise<void> {
  const text = String(message ?? "").trim();
  if (!text) return;
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("comments")
    .add({
      organizationId: companyId,
      jobId,
      targetType: "job",
      message: text,
      authorId: authorUid,
      authorName,
      authorRole: ["owner", "admin", "manager"].includes(authorRole) ? "admin" : "employee",
      createdAt: FieldValue.serverTimestamp(),
      readBy: [authorUid],
    });
}
