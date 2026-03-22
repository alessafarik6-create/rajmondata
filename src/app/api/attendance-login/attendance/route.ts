import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { loadTodayAttendanceEventsByEmployee } from "@/lib/attendance-day-server";
import { durationHoursForClosingCheckOut, isShiftOpenFromSorted } from "@/lib/attendance-shift-state";
import {
  closeWorkSegment,
  createWorkSegment,
  findOpenWorkSegment,
  loadEmployeeAndRatesForSegment,
  type WorkSegmentSource,
} from "@/lib/work-segment-server";

type Action = "check-in" | "check-out";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
  action?: Action;
  sourceType?: WorkSegmentSource;
  jobId?: string | null;
  jobName?: string | null;
  tariffId?: string | null;
  tariffName?: string | null;
  employeeName?: string;
};

function mapAction(a: Action): "check_in" | "check_out" {
  return a === "check-in" ? "check_in" : "check_out";
}

async function getAssignedTerminalJobIds(
  db: Firestore,
  companyId: string,
  employeeId: string
): Promise<string[]> {
  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  const data = empSnap.data() as Record<string, unknown> | undefined;
  return Array.isArray(data?.assignedTerminalJobIds)
    ? (data!.assignedTerminalJobIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * Zápis docházky z veřejné přihlašovací stránky — PIN v každém požadavku, bez JWT.
 * Při příchodu lze založit první pracovní segment (zakázka / tarif), při odchodu se uzavře otevřený segment.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId || "").trim();
  const employeeId = String(body.employeeId || "").trim();
  const pin = normalizeTerminalPin(body.pin != null ? String(body.pin) : "");
  const actionRaw = body.action;

  if (!companyId || !employeeId || !pin) {
    return NextResponse.json({ error: "Chybí companyId, employeeId nebo PIN." }, { status: 400 });
  }

  if (actionRaw !== "check-in" && actionRaw !== "check-out") {
    return NextResponse.json({ error: "Neplatná akce (očekáváno check-in nebo check-out)." }, { status: 400 });
  }

  const todayIso = new Date().toISOString().split("T")[0];
  const nowMs = Date.now();

  try {
    const pinOk = await verifyAttendancePinForEmployee(db, companyId, employeeId, pin);
    if (!pinOk) {
      return NextResponse.json({ error: "Neplatný PIN." }, { status: 401 });
    }

    const empSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    const ed = empSnap.data() as Record<string, unknown> | undefined;
    const defaultName =
      ed != null
        ? `${String(ed.firstName ?? "").trim()} ${String(ed.lastName ?? "").trim()}`.trim()
        : "";
    const employeeName =
      typeof body.employeeName === "string" && body.employeeName.trim()
        ? body.employeeName.trim()
        : defaultName;

    const byEmp = await loadTodayAttendanceEventsByEmployee(db, companyId, todayIso);
    const existing = byEmp.get(employeeId) ?? [];
    const shiftOpen = isShiftOpenFromSorted(existing);

    const assignedJobIds = await getAssignedTerminalJobIds(db, companyId, employeeId);

    const sourceType: WorkSegmentSource | null =
      body.sourceType === "tariff" ? "tariff" : body.sourceType === "job" ? "job" : null;

    if (actionRaw === "check-in" && shiftOpen) {
      return NextResponse.json(
        { error: "Směna je již zahájena — nelze znovu zaznamenat příchod." },
        { status: 409 }
      );
    }
    if (actionRaw === "check-out" && !shiftOpen) {
      return NextResponse.json(
        { error: "Nemáte otevřenou směnu — nelze zaznamenat odchod." },
        { status: 409 }
      );
    }

    if (actionRaw === "check-in" && sourceType === "job") {
      const jid = String(body.jobId || "").trim();
      if (!jid || !assignedJobIds.includes(jid)) {
        return NextResponse.json({ error: "Neplatná nebo nepřiřazená zakázka." }, { status: 400 });
      }
      const tSnap = await db.collection("companies").doc(companyId).collection("jobs").doc(jid).get();
      if (!tSnap.exists) {
        return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 400 });
      }
    }
    if (actionRaw === "check-in" && sourceType === "tariff") {
      const tid = String(body.tariffId || "").trim();
      if (!tid) {
        return NextResponse.json({ error: "Vyberte tarif." }, { status: 400 });
      }
      const tr = await db.collection("companies").doc(companyId).collection("work_tariffs").doc(tid).get();
      const td = tr.data() as { active?: boolean } | undefined;
      if (!tr.exists || td?.active !== true) {
        return NextResponse.json({ error: "Tarif neexistuje nebo není aktivní." }, { status: 400 });
      }
    }

    if (actionRaw === "check-in" && sourceType) {
      const jobId = sourceType === "job" ? String(body.jobId || "").trim() : null;
      const tariffId = sourceType === "tariff" ? String(body.tariffId || "").trim() : null;
      const meta = await loadEmployeeAndRatesForSegment(
        db,
        companyId,
        employeeId,
        sourceType,
        jobId,
        tariffId
      );
      if (sourceType === "job") {
        console.log("Employee selected job", { jobId });
      } else {
        console.log("Employee selected tariff", { tariffId });
      }
      await createWorkSegment({
        db,
        companyId,
        employeeId,
        employeeName: meta.employeeName,
        dateIso: todayIso,
        sourceType,
        jobId,
        jobName: sourceType === "job" ? meta.jobName ?? body.jobName ?? null : null,
        tariffId,
        tariffName: sourceType === "tariff" ? meta.tariffName ?? body.tariffName ?? null : null,
        hourlyRateCzk: meta.hourlyRateCzk,
      });
    }

    if (actionRaw === "check-out") {
      const open = await findOpenWorkSegment(db, companyId, employeeId, todayIso);
      if (open) {
        const rate =
          typeof (open.data() as { hourlyRateCzk?: number }).hourlyRateCzk === "number"
            ? (open.data() as { hourlyRateCzk: number }).hourlyRateCzk
            : null;
        await closeWorkSegment(open.ref, nowMs, rate);
      }
    }

    const type = mapAction(actionRaw);
    const date = todayIso;

    const docPayload: Record<string, unknown> = {
      employeeId,
      employeeName,
      type,
      timestamp: FieldValue.serverTimestamp(),
      date,
      source: "attendance-login",
    };

    if (body.jobId && type === "check_in") {
      docPayload.jobId = body.jobId;
      docPayload.jobName = typeof body.jobName === "string" ? body.jobName : "";
    }
    if (body.sourceType === "tariff" && type === "check_in" && body.tariffId) {
      docPayload.sourceType = "tariff";
      docPayload.tariffId = body.tariffId;
      docPayload.tariffName = typeof body.tariffName === "string" ? body.tariffName : "";
    }
    if (body.sourceType === "job" && type === "check_in") {
      docPayload.sourceType = "job";
    }

    if (type === "check_out") {
      docPayload.durationHours = durationHoursForClosingCheckOut(existing, nowMs);
    }

    await db.collection("companies").doc(companyId).collection("attendance").add(docPayload);

    if (type === "check_in") {
      console.log("Employee checked in", { employeeId });
    }
    console.log("Attendance saved");
    if (type === "check_out") {
      console.log("Employee checked out", { employeeId });
      console.log("Attendance session closed");
    }

    let activeSegment: {
      sourceType: "job" | "tariff";
      jobId: string | null;
      jobName: string;
      tariffId: string | null;
      tariffName: string;
      displayName: string;
    } | null = null;
    if (actionRaw === "check-in") {
      const openAfter = await findOpenWorkSegment(db, companyId, employeeId, todayIso);
      if (openAfter) {
        const d = openAfter.data() as {
          sourceType?: string;
          jobId?: string | null;
          jobName?: string;
          tariffId?: string | null;
          tariffName?: string;
          displayName?: string;
        };
        activeSegment = {
          sourceType: d.sourceType === "tariff" ? "tariff" : "job",
          jobId: typeof d.jobId === "string" ? d.jobId : null,
          jobName: typeof d.jobName === "string" ? d.jobName : "",
          tariffId: typeof d.tariffId === "string" ? d.tariffId : null,
          tariffName: typeof d.tariffName === "string" ? d.tariffName : "",
          displayName: typeof d.displayName === "string" ? d.displayName : "",
        };
      }
    }

    return NextResponse.json({ ok: true, activeSegment });
  } catch (e) {
    console.error("[attendance-login/attendance]", e);
    return NextResponse.json({ error: "Zápis docházky se nezdařil." }, { status: 500 });
  }
}
