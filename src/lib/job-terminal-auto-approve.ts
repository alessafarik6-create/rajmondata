/**
 * Po uzavření zakázkového úseku z terminálu docházky: automatické schválení výdělku,
 * pokud má zaměstnanec autoApproveJobEarnings (Admin SDK — obchází pravidla klienta pro work_time_blocks).
 */

import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  isJobTerminalAutoApprovedSegmentData,
  JOB_TERMINAL_AUTO_APPROVAL_SOURCE,
} from "@/lib/job-terminal-auto-shared";

/** Konstanta pro appliedAtReportId — žádný skutečný dokument daily_work_reports. */
export const AUTO_JOB_TERMINAL_REPORT_ID = "__auto_job_terminal__";

export { JOB_TERMINAL_AUTO_APPROVAL_SOURCE };
export const isJobTerminalAutoApprovedSegment = isJobTerminalAutoApprovedSegmentData;

/**
 * Součet payableAmountCzk z automaticky schválených blocích za den (prevence dvojího započtení s výkazem).
 */
export async function sumAutoJobTerminalBlockPayableCzkForDay(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<number> {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_time_blocks")
    .where("employeeId", "==", employeeId)
    .where("date", "==", dateIso)
    .limit(200)
    .get();
  let s = 0;
  snap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (!isJobTerminalAutoApprovedSegmentData(x)) return;
    const n = Number(x.payableAmountCzk);
    if (Number.isFinite(n) && n > 0) s += n;
  });
  return Math.round(s * 100) / 100;
}

/**
 * Volat ihned po closeWorkSegment na ref uzavřeného segmentu (check-out, přepnutí, ukončení úseku).
 * Idempotentní: dokument work_time_blocks/auto_terminal_{segmentId}.
 */
export async function maybeAutoApproveJobSegmentAfterTerminalClose(
  db: Firestore,
  companyId: string,
  segmentRef: DocumentReference,
  employeeId: string
): Promise<void> {
  const snap = await segmentRef.get();
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!snap.exists || !data) return;
  if (data.closed !== true) return;
  if (String(data.sourceType || "") !== "job") return;
  const jobId = String(data.jobId || "").trim();
  if (!jobId) return;

  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  const emp = empSnap.data() as Record<string, unknown> | undefined;
  if (emp?.autoApproveJobEarnings !== true) return;

  const blockId = `auto_terminal_${segmentRef.id}`;
  const blockRef = db.collection("companies").doc(companyId).collection("work_time_blocks").doc(blockId);
  const existingBlock = await blockRef.get();
  if (existingBlock.exists) return;

  const durationHours =
    typeof data.durationHours === "number" && Number.isFinite(data.durationHours) ? data.durationHours : 0;
  const totalAmountCzk =
    typeof data.totalAmountCzk === "number" && Number.isFinite(data.totalAmountCzk)
      ? Math.round(data.totalAmountCzk * 100) / 100
      : 0;
  const dateIso = String(data.date || "").slice(0, 10);
  if (durationHours <= 0 || dateIso.length < 10) return;

  const employeeName = String(data.employeeName || "").trim();
  const jobName = String(data.jobName || "").trim();
  const budgetImpact = String(data.budgetImpact || "");

  const batch = db.batch();

  const segMeta: Record<string, unknown> = {
    approvedAutomatically: true,
    approvalSource: JOB_TERMINAL_AUTO_APPROVAL_SOURCE,
    approvedAt: FieldValue.serverTimestamp(),
    approvedBySystem: true,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (budgetImpact === "pending" && totalAmountCzk > 0) {
    segMeta.budgetImpact = "applied";
    segMeta.appliedAtReportId = AUTO_JOB_TERMINAL_REPORT_ID;
    segMeta.appliedAt = FieldValue.serverTimestamp();
    const jref = db.collection("companies").doc(companyId).collection("jobs").doc(jobId);
    batch.set(jref, { laborCostApprovedCzk: FieldValue.increment(totalAmountCzk) }, { merge: true });
  }

  batch.update(segmentRef, segMeta as Record<string, FieldValue | string | boolean | null>);

  batch.set(blockRef, {
    companyId,
    employeeId,
    employeeName,
    date: dateIso,
    hours: durationHours,
    originalHours: durationHours,
    approvedHours: durationHours,
    payableAmountCzk: totalAmountCzk,
    reviewStatus: "approved",
    jobId,
    jobName: jobName || null,
    attendanceSegmentId: segmentRef.id,
    description: "Práce na zakázce (terminál, automatické schválení výdělku).",
    approvedAutomatically: true,
    approvalSource: JOB_TERMINAL_AUTO_APPROVAL_SOURCE,
    approvedAt: FieldValue.serverTimestamp(),
    approvedBySystem: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: "system:job-terminal-auto",
  });

  await batch.commit();
}
