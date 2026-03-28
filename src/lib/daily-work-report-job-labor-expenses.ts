/**
 * Náklady zakázky z ručních řádků schváleného denního výkazu práce (segmentJobSplits typ manual).
 * Terminálové úseky zakázky už promítají částku přes work_segments → applyApprovedJobLaborFromSegments
 * (laborCostApprovedCzk); tyto záznamy zde neduplikujeme.
 *
 * Idempotence: stabilní id dokumentu nákladu `dwrLabor_{reportDocId}_{splitIndex}`; při opakovaném
 * schválení se staré vazby smaží a znovu vytvoří podle aktuálního výkazu.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  isLegacyVirtualManualSegmentId,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";
import { DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE } from "@/lib/daily-work-report-job-labor-expenses-constants";
import { roundMoney2 } from "@/lib/vat-calculations";

export { DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE };

export type WorkReportLaborExpenseLink = {
  jobId: string;
  expenseId: string;
};

function isManualSegmentSplit(row: Record<string, unknown>): boolean {
  const st = String(row.segmentType ?? "").trim();
  if (st === DAILY_REPORT_ROW_SOURCE_MANUAL) return true;
  if (st === DAILY_REPORT_ROW_SOURCE_TERMINAL) return false;
  const sid = row.segmentId;
  if (sid === null || sid === undefined) return true;
  if (typeof sid === "string" && sid.trim() === "") return true;
  if (typeof sid === "string" && isLegacyVirtualManualSegmentId(sid)) return true;
  return false;
}

export function workReportLaborExpenseDocId(reportDocId: string, splitIndex: number): string {
  const safe = reportDocId.replace(/[/\\]/g, "_");
  return `dwrLabor_${safe}_${splitIndex}`;
}

export async function deleteWorkReportLaborJobExpenses(
  db: Firestore,
  companyId: string,
  links: WorkReportLaborExpenseLink[] | undefined | null
): Promise<void> {
  if (!links?.length) return;
  let batch = db.batch();
  let n = 0;
  for (const { jobId, expenseId } of links) {
    if (!jobId || !expenseId) continue;
    const ref = db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("expenses")
      .doc(expenseId);
    batch.delete(ref);
    n++;
    if (n >= 450) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

/**
 * Vytvoří / přepíše náklady v jobs/{jobId}/expenses pro ruční řádky výkazu se zakázkou.
 * Volat po smazání předchozích vazeb (deleteWorkReportLaborJobExpenses).
 */
export async function syncApprovedWorkReportLaborJobExpenses(params: {
  db: Firestore;
  companyId: string;
  reportDocId: string;
  report: Record<string, unknown>;
  employeeHourlyRateCzk: number;
  createdByUid: string;
}): Promise<WorkReportLaborExpenseLink[]> {
  const { db, companyId, reportDocId, report, employeeHourlyRateCzk, createdByUid } = params;
  const rate =
    Number.isFinite(employeeHourlyRateCzk) && employeeHourlyRateCzk > 0
      ? employeeHourlyRateCzk
      : 0;
  const date = String(report.date ?? "").slice(0, 10);
  const employeeId = String(report.employeeId ?? "").trim();
  const employeeName = String(report.employeeName ?? "").trim() || employeeId;
  const splits = report.segmentJobSplits;
  const links: WorkReportLaborExpenseLink[] = [];

  if (!Array.isArray(splits) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !employeeId) {
    return links;
  }

  let batch = db.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (batchOps > 0) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  };

  for (let i = 0; i < splits.length; i++) {
    const row = splits[i] as Record<string, unknown>;
    if (!isManualSegmentSplit(row)) continue;

    const jobId = String(row.jobId ?? "").trim();
    if (isNoJobSegmentJobId(jobId)) continue;

    const hours = Number(row.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;

    if (rate <= 0) {
      console.warn("[daily-work-report-job-labor] hourly rate missing or zero — náklad 0 Kč", {
        companyId,
        employeeId,
        reportDocId,
        splitIndex: i,
        jobId,
        hours: roundMoney2(hours),
      });
    }

    const amountNet = roundMoney2(hours * rate);
    if (amountNet <= 0) continue;

    const expenseId = workReportLaborExpenseDocId(reportDocId, i);
    const note = `Práce zaměstnance – výkaz práce · ${employeeName} · ${date} · ${roundMoney2(hours)} h × ${rate} Kč/h`;

    const expRef = db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("expenses")
      .doc(expenseId);

    batch.set(
      expRef,
      {
        companyId,
        jobId,
        amount: amountNet,
        amountNet,
        amountGross: amountNet,
        vatRate: 0,
        vatAmount: 0,
        date,
        note,
        source: DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE,
        sourceReportId: reportDocId,
        sourceReportRowIndex: i,
        sourceEmployeeId: employeeId,
        workReportHours: roundMoney2(hours),
        workReportHourlyRateCzk: rate,
        dokladId: null,
        fileUrl: null,
        fileType: null,
        fileName: null,
        storagePath: null,
        createdBy: createdByUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    links.push({ jobId, expenseId });
    batchOps++;
    if (batchOps >= 450) await commitBatch();
  }

  await commitBatch();
  return links;
}
