import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  formatJobNumberFromParts,
  jobNumberCounterDocId,
  parseJobNumberingSettings,
  previewNextJobNumber,
  resolveNumberingTypeForJobTag,
  type JobNumberingSettings,
} from "@/lib/jobs/job-numbering";

export function pragueCalendarYear(now = new Date()): number {
  const y = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
  }).format(now);
  return Number(y) || now.getFullYear();
}

export async function loadJobNumberingSettings(
  db: Firestore,
  companyId: string
): Promise<JobNumberingSettings> {
  const snap = await db.collection("companies").doc(companyId).get();
  return parseJobNumberingSettings(snap.data()?.jobNumberingSettings);
}

export async function allocateJobNumberAdmin(
  db: Firestore,
  companyId: string,
  jobTag: string | null | undefined
): Promise<{ jobNumber: string; typeId: string }> {
  const companyRef = db.collection("companies").doc(companyId);
  const year = pragueCalendarYear();

  return db.runTransaction(async (tx) => {
    const companySnap = await tx.get(companyRef);
    const settings = parseJobNumberingSettings(companySnap.data()?.jobNumberingSettings);
    const rule = resolveNumberingTypeForJobTag(settings, jobTag);
    const counterId = jobNumberCounterDocId(settings, rule.id, year);
    const counterRef = companyRef.collection("job_number_counters").doc(counterId);
    const counterSnap = await tx.get(counterRef);
    const start = rule.startSequence ?? 1;
    const nextSeq = counterSnap.exists
      ? Math.max(start, Number(counterSnap.data()?.nextSequence ?? start))
      : start;
    const jobNumber = formatJobNumberFromParts(rule.format, rule.prefix, year, nextSeq);

    const indexId = jobNumber.replace(/[/\\.#[\]*]/g, "_");
    const indexRef = companyRef.collection("job_number_index").doc(indexId);
    const indexSnap = await tx.get(indexRef);
    if (indexSnap.exists) {
      throw new Error("DUPLICATE_JOB_NUMBER");
    }

    tx.set(indexRef, {
      jobNumber,
      typeId: rule.id,
      year: settings.resetYearly ? year : null,
      allocatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      counterRef,
      {
        typeId: rule.id,
        nextSequence: nextSeq + 1,
        lastAssigned: jobNumber,
        year: settings.resetYearly ? year : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { jobNumber, typeId: rule.id };
  });
}

export type JobNumberMigrationRow = {
  jobId: string;
  jobName: string;
  assignedJobNumber: string;
  typeId: string;
};

export async function migrateMissingJobNumbersAdmin(
  db: Firestore,
  companyId: string,
  opts?: { dryRun?: boolean }
): Promise<{ rows: JobNumberMigrationRow[]; dryRun: boolean }> {
  const dryRun = opts?.dryRun !== false;
  const jobsSnap = await db.collection("companies").doc(companyId).collection("jobs").get();
  const rows: JobNumberMigrationRow[] = [];

  for (const doc of jobsSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const existing = String(data.jobNumber ?? data.orderNumber ?? "").trim();
    if (existing) continue;
    const jobTag = String(data.jobTag ?? "").trim() || null;
    if (dryRun) {
      const settings = await loadJobNumberingSettings(db, companyId);
      const rule = resolveNumberingTypeForJobTag(settings, jobTag);
      const year = pragueCalendarYear();
      const counterId = jobNumberCounterDocId(settings, rule.id, year);
      const counterSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("job_number_counters")
        .doc(counterId)
        .get();
      const start = rule.startSequence ?? 1;
      const nextSeq = counterSnap.exists
        ? Math.max(start, Number(counterSnap.data()?.nextSequence ?? start))
        : start;
      const preview = previewNextJobNumber(settings, rule, nextSeq, year);
      rows.push({
        jobId: doc.id,
        jobName: String(data.name ?? doc.id),
        assignedJobNumber: preview,
        typeId: rule.id,
      });
    } else {
      const { jobNumber, typeId } = await allocateJobNumberAdmin(db, companyId, jobTag);
      await doc.ref.set(
        {
          jobNumber,
          jobNumberTypeId: typeId,
          jobNumberAssignedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      rows.push({
        jobId: doc.id,
        jobName: String(data.name ?? doc.id),
        assignedJobNumber: jobNumber,
        typeId,
      });
    }
  }

  return { rows, dryRun };
}
