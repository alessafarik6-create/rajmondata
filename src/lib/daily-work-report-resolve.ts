/**
 * Serverová validace rozdělení času denního výkazu mezi zakázky (uzavřené segmenty terminálu).
 */

import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { parseAssignedWorklogJobIds } from "@/lib/assigned-jobs";
import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  NO_JOB_SEGMENT_JOB_ID,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";
import { summarizeAttendanceByDay, type AttendanceRow } from "@/lib/employee-attendance";
import {
  computeSegmentAmount,
  resolveEmployeeDefaultHourlyRate,
  resolveJobHourlyRate,
  resolveTariffHourlyRate,
} from "@/lib/work-segment-rates";

const EPS = 0.02;

/** Stejné minimum jako `FILTER_MIN_DURATION` v `daily-work-report-day-form.ts`. */
const MIN_SEGMENT_HOURS_DAILY_REPORT = 0.0001;

export type SegmentAllocOut = {
  segmentId: string | null;
  segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
  jobId: string;
  jobName: string | null;
};

export type SegmentJobSplitOut = {
  segmentId: string | null;
  segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
  jobId: string;
  jobName: string | null;
  hours: number;
};

function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

/** Délka úseku z dokumentu (durationHours nebo rozdíl start/end). */
function segmentDurationFromDoc(d: Record<string, unknown>): number {
  const dh =
    typeof d.durationHours === "number" && Number.isFinite(d.durationHours) ? d.durationHours : 0;
  if (dh > EPS) return roundHours(dh);
  const a = tsToDate(d.startAt);
  const b = tsToDate(d.endAt);
  if (a && b && b > a) {
    return roundHours((b.getTime() - a.getTime()) / 36e5);
  }
  return 0;
}

function segmentLockedFromTerminalData(d: Record<string, unknown>): {
  locked: boolean;
  mode: "job_terminal" | "tariff_terminal" | null;
  termJobId: string;
} {
  const st = String(d.sourceType || "");
  const termJobId = String(d.jobId || "").trim();
  if (st === "tariff") {
    return { locked: true, mode: "tariff_terminal", termJobId: "" };
  }
  if (st === "job" && termJobId !== "") {
    return { locked: true, mode: "job_terminal", termJobId };
  }
  return { locked: false, mode: null, termJobId: "" };
}

/**
 * Sloučí stejné zdroje segmentů jako klient výkazu: workDayId, employeeId+date a případně auth uid.
 */
async function fetchWorkSegmentDocsForDailyReport(
  db: Firestore,
  companyId: string,
  employeeId: string,
  callerUid: string,
  date: string
): Promise<Map<string, QueryDocumentSnapshot>> {
  const col = db.collection("companies").doc(companyId).collection("work_segments");
  const workDayId = `${employeeId}__${date}`;
  const tasks = [
    col.where("workDayId", "==", workDayId).get(),
    col.where("employeeId", "==", employeeId).where("date", "==", date).get(),
  ];
  if (callerUid && callerUid !== employeeId) {
    tasks.push(col.where("employeeId", "==", callerUid).where("date", "==", date).get());
    tasks.push(col.where("workDayId", "==", `${callerUid}__${date}`).get());
  }
  const snaps = await Promise.all(tasks);
  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      byId.set(d.id, d);
    }
  }
  return byId;
}

/** Uzavřené úseky job/tarif s kladnou délkou — odpovídá `closedTerminalSegmentsInDayScopedList` + `effectiveLockedUnlocked` na klientovi. */
function closedReportableTerminalSegmentIds(
  segmentById: Map<string, QueryDocumentSnapshot>
): Set<string> {
  const out = new Set<string>();
  for (const docSnap of segmentById.values()) {
    const d = docSnap.data() as Record<string, unknown>;
    if (d.closed !== true) continue;
    const st = String(d.sourceType || "").trim();
    if (st !== "job" && st !== "tariff") continue;
    if (segmentDurationFromDoc(d) <= MIN_SEGMENT_HOURS_DAILY_REPORT) continue;
    out.add(docSnap.id);
  }
  return out;
}

/**
 * Rozdělení času mezi zakázky (podle uzavřených segmentů).
 * Součet hodin na segment nesmí překročit durationHours; při odeslání ke schválení musí být celý čas rozvržen.
 */
export async function resolveSegmentJobSplits(
  db: Firestore,
  companyId: string,
  employeeId: string,
  date: string,
  callerUid: string,
  emp: Record<string, unknown>,
  rawSplits: Array<{ segmentId?: string; jobId?: string; hours?: unknown }> | undefined,
  mode: "draft" | "submit"
): Promise<{
  hoursSum: number;
  segmentJobSplits: SegmentJobSplitOut[];
  segmentAllocations: SegmentAllocOut[];
  primaryJobId: string | null;
  primaryJobName: string | null;
}> {
  const assigned = new Set(parseAssignedWorklogJobIds(emp));
  const jobInfoCache = new Map<string, { exists: boolean; name: string | null }>();

  const loadJobInfo = async (jid: string) => {
    let cached = jobInfoCache.get(jid);
    if (!cached) {
      const jobSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("jobs")
        .doc(jid)
        .get();
      cached = {
        exists: jobSnap.exists,
        name: jobSnap.exists
          ? String((jobSnap.data() as { name?: string })?.name || "").trim() || null
          : null,
      };
      jobInfoCache.set(jid, cached);
    }
    return cached;
  };

  const list = Array.isArray(rawSplits) ? rawSplits : [];
  if (list.length === 0) {
    throw new Error(
      "Chybí rozdělení času — doplňte alespoň jeden řádek u každého úseku terminálu (zakázka je volitelná)."
    );
  }

  const segmentById = await fetchWorkSegmentDocsForDailyReport(
    db,
    companyId,
    employeeId,
    callerUid,
    date
  );
  const closedIds = closedReportableTerminalSegmentIds(segmentById);

  if (closedIds.size === 0) {
    throw new Error(
      "Pro tento den nejsou žádné uzavřené úseky z terminálu (job/tarif) s kladnou délkou — nelze uložit výkaz."
    );
  }

  const bySegment = new Map<string, Array<{ jobId: string; hours: number }>>();
  const expectedWorkDayId = `${employeeId}__${date}`;
  const expectedWorkDayIdAuth =
    callerUid && callerUid !== employeeId ? `${callerUid}__${date}` : "";
  for (const row of list) {
    const sid = String(row.segmentId || "").trim();
    let jid = String(row.jobId ?? "").trim();
    const hr = Number(row.hours);
    if (!sid) {
      throw new Error("Každý řádek musí mít úsek docházky.");
    }
    if (!Number.isFinite(hr) || hr <= 0) {
      throw new Error("Počet hodin musí být kladné číslo.");
    }

    const docSnap = segmentById.get(sid);
    if (!docSnap) {
      throw new Error(`Úsek ${sid} neexistuje nebo nepatří k tomuto dni.`);
    }
    const d = docSnap.data() as Record<string, unknown>;
    const segEid = String(d.employeeId || "").trim();
    if (segEid !== employeeId && segEid !== callerUid) {
      throw new Error("Neplatný segment.");
    }
    const segDate = String(d.date || "").trim();
    const segWd = String(d.workDayId || "").trim();
    const wdOk =
      segWd === expectedWorkDayId ||
      (expectedWorkDayIdAuth !== "" && segWd === expectedWorkDayIdAuth);
    if (segDate !== date && !wdOk) {
      throw new Error("Neplatný segment.");
    }
    if (d.closed !== true) {
      throw new Error("Lze použít jen uzavřené úseky z docházky.");
    }

    const { locked, mode: lockMode, termJobId } = segmentLockedFromTerminalData(d);

    if (isNoJobSegmentJobId(jid)) {
      if (lockMode === "job_terminal") {
        throw new Error(
          "U úseku s vybranou zakázkou v terminálu musí být ve výkazu uvedena stejná zakázka."
        );
      }
      if (lockMode === "tariff_terminal" || lockMode === null) {
        jid = NO_JOB_SEGMENT_JOB_ID;
      }
    } else {
      if (lockMode === "tariff_terminal") {
        throw new Error("U tarifového úseku z terminálu nelze přiřadit zakázku — pouze popis práce.");
      }
      const jobInfo = await loadJobInfo(jid);
      if (!jobInfo.exists) {
        throw new Error("Vybraná zakázka neexistuje.");
      }
      if (
        assigned.size > 0 &&
        !assigned.has(jid) &&
        !(locked && lockMode === "job_terminal" && jid === termJobId)
      ) {
        throw new Error("Zakázka není zaměstnanci přiřazena pro výkaz práce.");
      }
    }

    const dh = segmentDurationFromDoc(d);
    if (dh <= 0) {
      throw new Error(`Úsek ${sid} nemá platnou délku (chybí durationHours i čas začátku/konce).`);
    }

    if (!bySegment.has(sid)) bySegment.set(sid, []);
    bySegment.get(sid)!.push({ jobId: jid, hours: roundHours(hr) });
  }

  let hoursSum = 0;
  const segmentJobSplits: SegmentJobSplitOut[] = [];

  for (const id of closedIds) {
    const rows = bySegment.get(id);
    if (!rows || rows.length === 0) {
      throw new Error(
        "U každého uzavřeného úseku terminálu přidejte alespoň jeden řádek s počtem hodin. Zakázka je volitelná (může jít o interní práci bez zakázky)."
      );
    }

    const docSnap = segmentById.get(id)!;
    const d = docSnap.data() as Record<string, unknown>;
    const duration = segmentDurationFromDoc(d);
    if (duration <= 0) {
      throw new Error(
        `Úsek ${id} nemá platnou délku (chybí durationHours i čas začátku/konce).`
      );
    }

    const { locked: lockedFromTerminal, mode: lockMode, termJobId } =
      segmentLockedFromTerminalData(d);

    if (lockedFromTerminal && lockMode === "job_terminal") {
      if (rows.length !== 1) {
        throw new Error(
          "U úseku byla v terminálu vybrána zakázka — čas nelze rozdělovat. Očekává se jeden řádek odpovídající záznamu z terminálu."
        );
      }
      const only = rows[0];
      if (only.jobId !== termJobId) {
        throw new Error(
          "Zakázka ve výkazu musí odpovídat zakázce vybrané v terminálu u tohoto úseku."
        );
      }
      if (Math.abs(only.hours - duration) > EPS) {
        throw new Error(
          `U úseku z terminálu s vybranou zakázkou musí být přiřazeno přesně ${duration} h (délka úseku).`
        );
      }
    }

    if (lockedFromTerminal && lockMode === "tariff_terminal") {
      if (rows.length !== 1) {
        throw new Error(
          "U úseku byl v terminálu zvolen tarif — čas nelze rozdělovat. Použijte jeden řádek bez zakázky (pouze popis práce)."
        );
      }
      const only = rows[0];
      if (!isNoJobSegmentJobId(only.jobId)) {
        throw new Error(
          "U tarifového úseku z terminálu nelze přiřadit zakázku — pouze textový popis práce."
        );
      }
      if (Math.abs(only.hours - duration) > EPS) {
        throw new Error(
          `U tarifového úseku z terminálu musí být uvedeno přesně ${duration} h (délka úseku).`
        );
      }
    }

    let sum = 0;
    for (const r of rows) {
      sum += r.hours;
    }
    sum = roundHours(sum);

    if (sum > duration + EPS) {
      throw new Error(
        `Součet hodin (${sum} h) překračuje délku úseku docházky (${duration} h).`
      );
    }
    if (mode === "submit" && sum < duration - EPS) {
      throw new Error(
        `U úseku musí být rozvrženo celých ${duration} h (zbývá ${roundHours(duration - sum)} h).`
      );
    }

    hoursSum += sum;

    for (const r of rows) {
      let jobName: string | null = null;
      if (!isNoJobSegmentJobId(r.jobId)) {
        const info = await loadJobInfo(r.jobId);
        jobName = info.name;
      }

      segmentJobSplits.push({
        segmentId: id,
        segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
        jobId: r.jobId,
        jobName,
        hours: r.hours,
      });
    }
  }

  const hoursRounded = roundHours(hoursSum);

  const segmentAllocations: SegmentAllocOut[] = [];
  for (const id of closedIds) {
    const first = segmentJobSplits.find((s) => s.segmentId === id);
    if (first) {
      segmentAllocations.push({
        segmentId: id,
        segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
        jobId: first.jobId,
        jobName: first.jobName,
      });
    }
  }

  const firstWithJob = segmentJobSplits.find((s) => !isNoJobSegmentJobId(s.jobId));

  return {
    hoursSum: hoursRounded,
    segmentJobSplits,
    segmentAllocations,
    primaryJobId: firstWithJob?.jobId ?? null,
    primaryJobName: firstWithJob?.jobName ?? null,
  };
}

async function fetchAttendanceWorkedHoursForDay(
  db: Firestore,
  companyId: string,
  employeeId: string,
  callerUid: string,
  date: string
): Promise<number | null> {
  const col = db.collection("companies").doc(companyId).collection("attendance");
  const rows: AttendanceRow[] = [];
  const ids = [employeeId, callerUid].filter((x, i, a) => Boolean(x) && a.indexOf(x) === i) as string[];
  for (const eid of ids) {
    const snap = await col.where("employeeId", "==", eid).limit(500).get();
    snap.docs.forEach((d) => rows.push({ id: d.id, ...d.data() } as AttendanceRow));
  }
  const summaries = summarizeAttendanceByDay(rows, { employeeId, authUid: callerUid });
  const s = summaries.find((x) => x.date === date);
  return s?.hoursWorked ?? null;
}

async function resolveManualJobSplitRows(
  db: Firestore,
  companyId: string,
  emp: Record<string, unknown>,
  manualRows: Array<{ jobId: string; hours: number }>,
  maxManualHours: number,
  mode: "draft" | "submit"
): Promise<{
  sumManual: number;
  segmentJobSplits: SegmentJobSplitOut[];
  segmentAllocations: SegmentAllocOut[];
  primaryJobId: string | null;
  primaryJobName: string | null;
}> {
  const assigned = new Set(parseAssignedWorklogJobIds(emp));
  let sum = 0;
  const segmentJobSplits: SegmentJobSplitOut[] = [];

  for (const row of manualRows) {
    let jid = String(row.jobId ?? "").trim();
    const hr = Number(row.hours);
    if (!Number.isFinite(hr) || hr <= 0) {
      throw new Error("Počet hodin musí být kladné číslo.");
    }
    let jobName: string | null = null;
    if (isNoJobSegmentJobId(jid)) {
      jid = NO_JOB_SEGMENT_JOB_ID;
    } else {
      const jobSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("jobs")
        .doc(jid)
        .get();
      if (!jobSnap.exists) {
        throw new Error("Vybraná zakázka neexistuje.");
      }
      if (assigned.size > 0 && !assigned.has(jid)) {
        throw new Error("Zakázka není zaměstnanci přiřazena pro výkaz práce.");
      }
      jobName = String((jobSnap.data() as { name?: string })?.name || "").trim() || null;
    }
    const hoursRounded = roundHours(hr);
    sum += hoursRounded;

    segmentJobSplits.push({
      segmentId: null,
      segmentType: DAILY_REPORT_ROW_SOURCE_MANUAL,
      jobId: jid,
      jobName,
      hours: hoursRounded,
    });
  }

  sum = roundHours(sum);
  if (sum > maxManualHours + EPS) {
    throw new Error(
      `Součet ručních hodin (${sum} h) překračuje dostupný rámec (${roundHours(maxManualHours)} h).`
    );
  }
  if (mode === "submit" && sum < maxManualHours - EPS) {
    throw new Error(
      `Rozdělte ručně ještě ${roundHours(maxManualHours - sum)} h (zbývá doplnit oproti dostupnému času).`
    );
  }

  const firstWithJob = segmentJobSplits.find((s) => !isNoJobSegmentJobId(s.jobId));
  const segmentAllocations: SegmentAllocOut[] = [];
  if (segmentJobSplits.length > 0) {
    const h = segmentJobSplits[0]!;
    segmentAllocations.push({
      segmentId: null,
      segmentType: DAILY_REPORT_ROW_SOURCE_MANUAL,
      jobId: h.jobId,
      jobName: h.jobName,
    });
  }

  return {
    sumManual: sum,
    segmentJobSplits,
    segmentAllocations,
    primaryJobId: firstWithJob?.jobId ?? null,
    primaryJobName: firstWithJob?.jobName ?? null,
  };
}

/**
 * Úseky z terminálu + ruční řádky (např. tarif z terminálu a zbytek směny z docházky).
 */
export async function resolveTerminalPlusManualJobSplits(
  db: Firestore,
  companyId: string,
  employeeId: string,
  callerUid: string,
  date: string,
  emp: Record<string, unknown>,
  terminalRows: Array<{ segmentId: string; jobId: string; hours: number }>,
  manualRows: Array<{ jobId: string; hours: number }>,
  mode: "draft" | "submit"
): Promise<{
  hoursSum: number;
  segmentJobSplits: SegmentJobSplitOut[];
  segmentAllocations: SegmentAllocOut[];
  primaryJobId: string | null;
  primaryJobName: string | null;
}> {
  const terminalResolved = await resolveSegmentJobSplits(
    db,
    companyId,
    employeeId,
    date,
    callerUid,
    emp,
    terminalRows.map((r) => ({ segmentId: r.segmentId, jobId: r.jobId, hours: r.hours })),
    mode
  );

  const attendanceHours = await fetchAttendanceWorkedHoursForDay(
    db,
    companyId,
    employeeId,
    callerUid,
    date
  );
  if (attendanceHours == null || attendanceHours <= EPS) {
    throw new Error(
      "Pro tento den není v docházce žádný odpracovaný čas — výkaz nelze uložit."
    );
  }

  const maxManual = roundHours(attendanceHours - terminalResolved.hoursSum);
  if (maxManual < -EPS) {
    throw new Error(
      "Součet hodin zaznamenaných v úsecích terminálu je vyšší než odpracovaný čas z docházky."
    );
  }

  const manualResolved = await resolveManualJobSplitRows(
    db,
    companyId,
    emp,
    manualRows,
    Math.max(0, maxManual),
    mode
  );

  const total = roundHours(terminalResolved.hoursSum + manualResolved.sumManual);
  if (total > attendanceHours + EPS) {
    throw new Error(
      `Celkový součet (${total} h) překračuje odpracovaný čas z docházky (${attendanceHours} h).`
    );
  }
  if (mode === "submit" && total < attendanceHours - EPS) {
    throw new Error(
      `Dohromady musí být rozvrženo ${attendanceHours} h z docházky (nyní ${total} h, zbývá ${roundHours(attendanceHours - total)} h).`
    );
  }

  const firstTerminalJob = terminalResolved.segmentJobSplits.find(
    (s) => !isNoJobSegmentJobId(s.jobId)
  );
  const firstManualJob = manualResolved.segmentJobSplits.find(
    (s) => !isNoJobSegmentJobId(s.jobId)
  );
  const firstWithJob = firstTerminalJob ?? firstManualJob;

  return {
    hoursSum: total,
    segmentJobSplits: [...terminalResolved.segmentJobSplits, ...manualResolved.segmentJobSplits],
    segmentAllocations: [...terminalResolved.segmentAllocations, ...manualResolved.segmentAllocations],
    primaryJobId: firstWithJob?.jobId ?? null,
    primaryJobName: firstWithJob?.jobName ?? null,
  };
}

/**
 * Výkaz bez uzavřených úseků terminálu — jen rozdělení odpracovaných hodin z docházky.
 */
export async function resolveAttendanceOnlyJobSplits(
  db: Firestore,
  companyId: string,
  employeeId: string,
  callerUid: string,
  date: string,
  emp: Record<string, unknown>,
  manualRows: Array<{ jobId: string; hours: number }>,
  mode: "draft" | "submit"
): Promise<{
  hoursSum: number;
  segmentJobSplits: SegmentJobSplitOut[];
  segmentAllocations: SegmentAllocOut[];
  primaryJobId: string | null;
  primaryJobName: string | null;
}> {
  if (manualRows.length === 0) {
    throw new Error("Chybí rozdělení času podle zakázek — doplňte alespoň jeden řádek.");
  }

  const attendanceHours = await fetchAttendanceWorkedHoursForDay(
    db,
    companyId,
    employeeId,
    callerUid,
    date
  );
  if (attendanceHours == null || attendanceHours <= EPS) {
    throw new Error(
      "Pro tento den není v docházce žádný odpracovaný čas — výkaz nelze uložit."
    );
  }

  const mr = await resolveManualJobSplitRows(
    db,
    companyId,
    emp,
    manualRows,
    attendanceHours,
    mode
  );

  return {
    hoursSum: mr.sumManual,
    segmentJobSplits: mr.segmentJobSplits,
    segmentAllocations: mr.segmentAllocations,
    primaryJobId: mr.primaryJobId,
    primaryJobName: mr.primaryJobName,
  };
}

/** Orientační výše mzdy: tarify podle ceníku tarifu, jinak zakázka / výchozí sazba zaměstnance. */
export async function estimateLaborFromJobSplits(
  db: Firestore,
  companyId: string,
  emp: Record<string, unknown>,
  splits: SegmentJobSplitOut[]
): Promise<number> {
  const empDefault = resolveEmployeeDefaultHourlyRate(emp);
  const segCol = db.collection("companies").doc(companyId).collection("work_segments");
  const tariffCol = db.collection("companies").doc(companyId).collection("work_tariffs");

  const segmentById = new Map<string, Record<string, unknown>>();
  const tariffRateById = new Map<string, number | null>();

  for (const s of splits) {
    const sid = s.segmentId;
    if (sid == null || String(sid).trim() === "") continue;
    const id = String(sid);
    if (!segmentById.has(id)) {
      const snap = await segCol.doc(id).get();
      segmentById.set(id, snap.exists ? (snap.data() as Record<string, unknown>) : {});
    }
  }

  for (const [, d] of segmentById) {
    if (String(d.sourceType || "") !== "tariff") continue;
    const tid = String(d.tariffId || "").trim();
    if (!tid || tariffRateById.has(tid)) continue;
    const tr = await tariffCol.doc(tid).get();
    tariffRateById.set(tid, resolveTariffHourlyRate(tr.data() as Record<string, unknown> | undefined));
  }

  let total = 0;
  for (const s of splits) {
    if (s.segmentType === DAILY_REPORT_ROW_SOURCE_MANUAL || s.segmentId == null) {
      if (isNoJobSegmentJobId(s.jobId)) {
        total += computeSegmentAmount(s.hours, empDefault);
      } else {
        const jobSnap = await db
          .collection("companies")
          .doc(companyId)
          .collection("jobs")
          .doc(s.jobId)
          .get();
        const jd = jobSnap.data() as Record<string, unknown> | undefined;
        const rate = resolveJobHourlyRate(jd, empDefault);
        total += computeSegmentAmount(s.hours, rate);
      }
      continue;
    }

    const segData = segmentById.get(s.segmentId) ?? {};
    if (String(segData.sourceType || "") === "tariff") {
      const tid = String(segData.tariffId || "").trim();
      let rate = tid ? tariffRateById.get(tid) ?? null : null;
      if (rate == null && typeof segData.totalAmountCzk === "number" && Number.isFinite(segData.totalAmountCzk)) {
        const dh = segmentDurationFromDoc(segData);
        if (dh > EPS) {
          rate = Math.round((segData.totalAmountCzk / dh) * 100) / 100;
        }
      }
      total += computeSegmentAmount(s.hours, rate);
      continue;
    }

    if (isNoJobSegmentJobId(s.jobId)) {
      total += computeSegmentAmount(s.hours, empDefault);
      continue;
    }
    const jobSnap = await db.collection("companies").doc(companyId).collection("jobs").doc(s.jobId).get();
    const jd = jobSnap.data() as Record<string, unknown> | undefined;
    const rate = resolveJobHourlyRate(jd, empDefault);
    total += computeSegmentAmount(s.hours, rate);
  }
  return Math.round(total * 100) / 100;
}
