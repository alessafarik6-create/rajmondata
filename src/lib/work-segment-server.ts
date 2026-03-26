import type { DocumentReference, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  computeSegmentAmount,
  resolveEmployeeDefaultHourlyRate,
  resolveJobHourlyRate,
  resolveTariffHourlyRate,
} from "@/lib/work-segment-rates";
import {
  buildTerminalActiveSegmentMapFromDocs,
  pickPreferredOpenWorkSegmentDoc,
  type TerminalActiveSegment,
} from "@/lib/terminal-active-segment";
import { isJobTerminalAutoApprovedSegmentData } from "@/lib/job-terminal-auto-shared";

export type WorkSegmentSource = "job" | "tariff";

export function workDayId(employeeId: string, dateIso: string): string {
  return `${employeeId}__${dateIso}`;
}

export async function findOpenWorkSegment(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<QueryDocumentSnapshot | null> {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("employeeId", "==", employeeId)
    .where("date", "==", dateIso)
    .where("closed", "==", false)
    .limit(10)
    .get();
  if (snap.empty) return null;
  return pickPreferredOpenWorkSegmentDoc(snap.docs);
}

/** Jeden dotaz: všichni zaměstnanci s otevřeným úsekem za den (terminál / API). */
export async function loadTodayOpenTerminalSegmentsByEmployee(
  db: Firestore,
  companyId: string,
  dateIso: string
): Promise<Map<string, TerminalActiveSegment>> {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("date", "==", dateIso)
    .where("closed", "==", false)
    .get();
  return buildTerminalActiveSegmentMapFromDocs(snap.docs);
}

export async function closeWorkSegment(
  segmentRef: DocumentReference,
  nowMs: number,
  hourlyRateUsed: number | null
): Promise<{ durationHours: number; totalAmountCzk: number }> {
  const snap = await segmentRef.get();
  const data = snap.data() as
    | {
        startAt?: { toMillis?: () => number };
        hourlyRateCzk?: number;
      }
    | undefined;
  const startMs =
    data?.startAt && typeof data.startAt.toMillis === "function"
      ? data.startAt.toMillis()
      : nowMs;
  const durationHours = Math.max(0, Math.round(((nowMs - startMs) / 36e5) * 100) / 100);
  const rate =
    hourlyRateUsed != null
      ? hourlyRateUsed
      : typeof data?.hourlyRateCzk === "number"
        ? data.hourlyRateCzk
        : null;
  const totalAmountCzk = computeSegmentAmount(durationHours, rate);

  await segmentRef.update({
    closed: true,
    endAt: Timestamp.fromMillis(nowMs),
    durationHours,
    totalAmountCzk,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log("Work segment ended", { durationHours, totalAmountCzk });
  console.log("Computed segment amount", { durationHours, totalAmountCzk });
  return { durationHours, totalAmountCzk };
}

export async function createWorkSegment(params: {
  db: Firestore;
  companyId: string;
  employeeId: string;
  employeeName: string;
  dateIso: string;
  sourceType: WorkSegmentSource;
  jobId?: string | null;
  jobName?: string | null;
  tariffId?: string | null;
  tariffName?: string | null;
  hourlyRateCzk: number | null;
}): Promise<string> {
  const {
    db,
    companyId,
    employeeId,
    employeeName,
    dateIso,
    sourceType,
    jobId,
    jobName,
    tariffId,
    tariffName,
    hourlyRateCzk,
  } = params;

  const wd = workDayId(employeeId, dateIso);
  const displayName =
    sourceType === "job"
      ? String(jobName || jobId || "Zakázka")
      : String(tariffName || tariffId || "Tarif");

  const ref = await db.collection("companies").doc(companyId).collection("work_segments").add({
    companyId,
    employeeId,
    employeeName,
    date: dateIso,
    workDayId: wd,
    sourceType,
    jobId: sourceType === "job" ? jobId ?? null : null,
    jobName: sourceType === "job" ? jobName ?? "" : "",
    tariffId: sourceType === "tariff" ? tariffId ?? null : null,
    tariffName: sourceType === "tariff" ? tariffName ?? "" : "",
    displayName,
    hourlyRateCzk: hourlyRateCzk ?? null,
    startAt: FieldValue.serverTimestamp(),
    endAt: null,
    closed: false,
    durationHours: null,
    totalAmountCzk: null,
    budgetImpact: sourceType === "job" ? "pending" : "none",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log("Opening new work segment", { id: ref.id, sourceType, displayName });
  console.log("Work segment started", { segmentId: ref.id, sourceType, displayName });
  return ref.id;
}

export type WorkSegmentDoc = {
  id: string;
  sourceType: WorkSegmentSource;
  jobId?: string | null;
  tariffId?: string | null;
  displayName?: string;
  totalAmountCzk?: number | null;
  durationHours?: number | null;
  budgetImpact?: string;
  closed?: boolean;
};

export async function loadClosedSegmentsForWorkDay(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<WorkSegmentDoc[]> {
  const wd = workDayId(employeeId, dateIso);
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("workDayId", "==", wd)
    .where("closed", "==", true)
    .get();
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      sourceType: (x.sourceType === "tariff" ? "tariff" : "job") as WorkSegmentSource,
      jobId: typeof x.jobId === "string" ? x.jobId : null,
      tariffId: typeof x.tariffId === "string" ? x.tariffId : null,
      displayName: typeof x.displayName === "string" ? x.displayName : "",
      totalAmountCzk: typeof x.totalAmountCzk === "number" ? x.totalAmountCzk : null,
      durationHours: typeof x.durationHours === "number" ? x.durationHours : null,
      budgetImpact: typeof x.budgetImpact === "string" ? x.budgetImpact : undefined,
      closed: x.closed === true,
    };
  });
}

export async function loadActiveWorkTariffs(
  db: Firestore,
  companyId: string
): Promise<
  { id: string; name: string; hourlyRateCzk: number | null; color?: string | null; active: boolean }[]
> {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_tariffs")
    .where("active", "==", true)
    .limit(80)
    .get();
  const out: {
    id: string;
    name: string;
    hourlyRateCzk: number | null;
    color?: string | null;
    active: boolean;
  }[] = [];
  snap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    out.push({
      id: d.id,
      name: typeof x.name === "string" ? x.name : d.id,
      hourlyRateCzk:
        typeof x.hourlyRateCzk === "number"
          ? x.hourlyRateCzk
          : typeof x.hourlyRate === "number"
            ? x.hourlyRate
            : null,
      color: typeof x.color === "string" ? x.color : null,
      active: x.active === true,
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  return out;
}

export async function loadEmployeeAndRatesForSegment(
  db: Firestore,
  companyId: string,
  employeeId: string,
  sourceType: WorkSegmentSource,
  jobId: string | null | undefined,
  tariffId: string | null | undefined
): Promise<{
  employeeName: string;
  hourlyRateCzk: number | null;
  jobName?: string;
  tariffName?: string;
}> {
  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  const emp = empSnap.data() as Record<string, unknown> | undefined;
  const employeeName =
    emp != null
      ? `${String(emp.firstName ?? "").trim()} ${String(emp.lastName ?? "").trim()}`.trim()
      : employeeId;
  const empDefault = resolveEmployeeDefaultHourlyRate(emp);

  if (sourceType === "tariff") {
    if (!tariffId) return { employeeName, hourlyRateCzk: null };
    const tSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("work_tariffs")
      .doc(tariffId)
      .get();
    const td = tSnap.data() as Record<string, unknown> | undefined;
    const hourlyRateCzk = resolveTariffHourlyRate(td);
    const tariffName = typeof td?.name === "string" ? td.name : tariffId;
    return { employeeName, hourlyRateCzk, tariffName };
  }

  if (!jobId) return { employeeName, hourlyRateCzk: empDefault };
  const jSnap = await db.collection("companies").doc(companyId).collection("jobs").doc(jobId).get();
  const jd = jSnap.data() as Record<string, unknown> | undefined;
  const jobName = typeof jd?.name === "string" ? jd.name : jobId;
  const hourlyRateCzk = resolveJobHourlyRate(jd, empDefault);
  return { employeeName, hourlyRateCzk, jobName };
}

/** Součet částek uzavřených segmentů za den (výplata / odhad). */
export async function sumClosedSegmentAmountsForWorkDay(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<number> {
  const wd = workDayId(employeeId, dateIso);
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("workDayId", "==", wd)
    .where("closed", "==", true)
    .get();
  let t = 0;
  snap.forEach((d) => {
    const x = d.data() as { totalAmountCzk?: number };
    if (typeof x.totalAmountCzk === "number") t += x.totalAmountCzk;
  });
  return Math.round(t * 100) / 100;
}

/**
 * Po schválení denního výkazu: promítne schválené náklady práce do zakázek (jednou).
 * Tarify se rozpočtu zakázek netýkají.
 */
export async function applyApprovedJobLaborFromSegments(
  db: Firestore,
  companyId: string,
  employeeId: string,
  dateIso: string,
  reportDocId: string
): Promise<{ totalClosedSegmentPayCzk: number }> {
  const wd = workDayId(employeeId, dateIso);
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("workDayId", "==", wd)
    .get();

  let totalPay = 0;
  const closed = snap.docs.filter((d) => (d.data() as { closed?: boolean }).closed === true);
  for (const d of closed) {
    const raw = d.data() as Record<string, unknown>;
    if (isJobTerminalAutoApprovedSegmentData(raw)) continue;
    const x = raw as { totalAmountCzk?: number };
    if (typeof x.totalAmountCzk === "number") totalPay += x.totalAmountCzk;
  }
  totalPay = Math.round(totalPay * 100) / 100;

  const batch = db.batch();
  const jobTotals = new Map<string, number>();
  let batchOps = 0;
  for (const d of closed) {
    const x = d.data() as {
      sourceType?: string;
      budgetImpact?: string;
      jobId?: string;
      totalAmountCzk?: number;
    };
    if (x.sourceType !== "job" || x.budgetImpact !== "pending") continue;
    const jid = typeof x.jobId === "string" ? x.jobId : "";
    if (!jid) continue;
    const amt = typeof x.totalAmountCzk === "number" ? x.totalAmountCzk : 0;
    jobTotals.set(jid, (jobTotals.get(jid) || 0) + amt);
    batch.update(d.ref, {
      budgetImpact: "applied",
      appliedAtReportId: reportDocId,
      appliedAt: FieldValue.serverTimestamp(),
    });
    batchOps += 1;
  }

  for (const [jobId, addAmt] of jobTotals) {
    if (addAmt <= 0) continue;
    const jref = db.collection("companies").doc(companyId).collection("jobs").doc(jobId);
    batch.set(
      jref,
      {
        laborCostApprovedCzk: FieldValue.increment(addAmt),
      },
      { merge: true }
    );
    batchOps += 1;
    console.log("Approved labor cost applied to job budget", { jobId, addAmt });
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  return { totalClosedSegmentPayCzk: totalPay };
}
