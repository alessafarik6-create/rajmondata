/**
 * Serverová validace rozdělení času denního výkazu mezi zakázky (uzavřené segmenty terminálu).
 */

import type { Firestore } from "firebase-admin/firestore";
import { parseAssignedWorklogJobIds } from "@/lib/assigned-jobs";
import {
  NO_JOB_SEGMENT_JOB_ID,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";
import {
  computeSegmentAmount,
  resolveEmployeeDefaultHourlyRate,
  resolveJobHourlyRate,
} from "@/lib/work-segment-rates";

const EPS = 0.02;

export type SegmentAllocOut = { segmentId: string; jobId: string; jobName: string | null };

export type SegmentJobSplitOut = {
  segmentId: string;
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
 * Rozdělení času mezi zakázky (podle uzavřených segmentů).
 * Součet hodin na segment nesmí překročit durationHours; při odeslání ke schválení musí být celý čas rozvržen.
 */
export async function resolveSegmentJobSplits(
  db: Firestore,
  companyId: string,
  employeeId: string,
  date: string,
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
  const list = Array.isArray(rawSplits) ? rawSplits : [];
  if (list.length === 0) {
    throw new Error("Chybí rozdělení času podle zakázek — doplňte alespoň jeden řádek u každého úseku.");
  }

  const segSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("work_segments")
    .where("employeeId", "==", employeeId)
    .where("date", "==", date)
    .get();

  const byId = new Map(segSnap.docs.map((d) => [d.id, d]));
  const closedIds = new Set(
    segSnap.docs
      .filter((d) => (d.data() as { closed?: boolean }).closed === true)
      .map((d) => d.id)
  );

  if (closedIds.size === 0) {
    throw new Error(
      "Pro tento den nejsou žádné uzavřené úseky z docházkového terminálu — nelze uložit výkaz."
    );
  }

  const bySegment = new Map<string, Array<{ jobId: string; hours: number }>>();
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

    const docSnap = byId.get(sid);
    if (!docSnap) {
      throw new Error(`Úsek ${sid} neexistuje nebo nepatří k tomuto dni.`);
    }
    const d = docSnap.data() as Record<string, unknown>;
    if (String(d.employeeId || "") !== employeeId || String(d.date || "") !== date) {
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
      if (
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
      throw new Error("U každého uzavřeného úseku docházky musíte přidat alespoň jeden řádek s zakázkou a hodinami.");
    }

    const docSnap = byId.get(id)!;
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
        const jobSnap = await db
          .collection("companies")
          .doc(companyId)
          .collection("jobs")
          .doc(r.jobId)
          .get();
        jobName = jobSnap.exists
          ? String((jobSnap.data() as { name?: string })?.name || "").trim() || null
          : null;
      }

      segmentJobSplits.push({
        segmentId: id,
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

/** Orientační výše mzdy z rozdělení podle sazeb zakázek (ne z částky terminálového segmentu). */
export async function estimateLaborFromJobSplits(
  db: Firestore,
  companyId: string,
  emp: Record<string, unknown>,
  splits: SegmentJobSplitOut[]
): Promise<number> {
  const empDefault = resolveEmployeeDefaultHourlyRate(emp);
  let total = 0;
  for (const s of splits) {
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
