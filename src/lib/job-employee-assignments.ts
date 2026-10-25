/**
 * Sdílená logika přiřazení zaměstnanců k zakázce (jobMembers + assignedEmployeeIds + profil zaměstnance).
 */

import type { Firestore } from "firebase/firestore";
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
} from "firebase/firestore";
import {
  memberPermissionsForAccessMode,
  syncJobEmployeeSummary,
  type JobAccessMode,
  type JobRoleOnSite,
} from "@/lib/job-employee-access";

export type AssignEmployeeToJobInput = {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobRecord: Record<string, unknown>;
  employeeId: string;
  authUserId?: string | null;
  roleOnJob?: JobRoleOnSite | string;
  accessMode?: JobAccessMode;
  isJobLead?: boolean;
  workStartDate?: string | null;
  workEndDate?: string | null;
  updatedByUid: string;
};

function jobDisplayName(jobRecord: Record<string, unknown>, jobId: string): string {
  if (typeof jobRecord.name === "string" && jobRecord.name.trim()) {
    return jobRecord.name.trim();
  }
  const title = (jobRecord as { title?: unknown }).title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return jobId;
}

export async function assignEmployeeToJob(input: AssignEmployeeToJobInput): Promise<void> {
  const {
    firestore,
    companyId,
    jobId,
    jobRecord,
    employeeId,
    authUserId,
    roleOnJob = "montaznik",
    accessMode = "limited",
    isJobLead = false,
    workStartDate,
    workEndDate,
    updatedByUid,
  } = input;

  const perms = memberPermissionsForAccessMode(accessMode);
  const assignedAt = new Date().toISOString();

  await setDoc(
    doc(firestore, "companies", companyId, "jobs", jobId, "jobMembers", employeeId),
    {
      employeeId,
      authUserId: authUserId ?? null,
      roleOnJob,
      accessMode,
      jobPermissions: perms,
      assignedAt,
      workStartDate: workStartDate?.trim() || null,
      workEndDate: workEndDate?.trim() || null,
      isJobLead: isJobLead === true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: updatedByUid,
    },
    { merge: true }
  );

  await updateDoc(doc(firestore, "companies", companyId, "employees", employeeId), {
    assignedJobIds: arrayUnion(jobId),
    assignedWorklogJobIds: arrayUnion(jobId),
    [`assignedWorklogJobsById.${jobId}`]: jobDisplayName(jobRecord, jobId),
    updatedAt: serverTimestamp(),
  });

  const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
  await updateDoc(jobRef, {
    assignedEmployeeIds: authUserId
      ? arrayUnion(employeeId, authUserId)
      : arrayUnion(employeeId),
    updatedAt: serverTimestamp(),
  });

  if (isJobLead) {
    await updateDoc(jobRef, {
      jobLeadEmployeeId: employeeId,
      updatedAt: serverTimestamp(),
    });
  }

  await syncJobEmployeeSummary(firestore, companyId, jobId, jobRecord);
}

export async function removeEmployeeFromJob(input: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobRecord: Record<string, unknown>;
  employeeId: string;
  authUserId?: string | null;
}): Promise<void> {
  const { firestore, companyId, jobId, jobRecord, employeeId, authUserId } = input;

  await deleteDoc(
    doc(firestore, "companies", companyId, "jobs", jobId, "jobMembers", employeeId)
  );

  await updateDoc(doc(firestore, "companies", companyId, "employees", employeeId), {
    assignedJobIds: arrayRemove(jobId),
    assignedWorklogJobIds: arrayRemove(jobId),
    [`assignedWorklogJobsById.${jobId}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });

  const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
  await updateDoc(jobRef, {
    assignedEmployeeIds: arrayRemove(employeeId),
    updatedAt: serverTimestamp(),
  });
  if (authUserId) {
    await updateDoc(jobRef, {
      assignedEmployeeIds: arrayRemove(authUserId),
      updatedAt: serverTimestamp(),
    });
  }

  const lead = jobRecord.jobLeadEmployeeId;
  if (lead === employeeId) {
    await updateDoc(jobRef, {
      jobLeadEmployeeId: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }

  await syncJobEmployeeSummary(firestore, companyId, jobId, jobRecord);
}

export async function setJobLeadEmployee(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  employeeId: string | null,
  memberRefs: DocumentReference[]
): Promise<void> {
  const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
  if (!employeeId) {
    await updateDoc(jobRef, { jobLeadEmployeeId: deleteField(), updatedAt: serverTimestamp() });
  } else {
    await updateDoc(jobRef, { jobLeadEmployeeId: employeeId, updatedAt: serverTimestamp() });
  }
  for (const ref of memberRefs) {
    const isLead = ref.id === employeeId;
    await setDoc(ref, { isJobLead: isLead, updatedAt: serverTimestamp() }, { merge: true });
  }
}
