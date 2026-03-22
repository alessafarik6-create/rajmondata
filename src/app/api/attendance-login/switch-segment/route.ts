import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { loadTodayAttendanceEventsByEmployee } from "@/lib/attendance-day-server";
import { isShiftOpenFromSorted } from "@/lib/attendance-shift-state";
import {
  closeWorkSegment,
  createWorkSegment,
  findOpenWorkSegment,
  loadEmployeeAndRatesForSegment,
  type WorkSegmentSource,
} from "@/lib/work-segment-server";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
  sourceType?: WorkSegmentSource;
  jobId?: string | null;
  jobName?: string | null;
  tariffId?: string | null;
  tariffName?: string | null;
};

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId || "").trim();
  const employeeId = String(body.employeeId || "").trim();
  const pin = normalizeTerminalPin(body.pin != null ? String(body.pin) : "");
  const sourceType = body.sourceType === "tariff" ? "tariff" : body.sourceType === "job" ? "job" : null;

  if (!companyId || !employeeId || !pin || !sourceType) {
    return NextResponse.json(
      { error: "Chybí companyId, employeeId, PIN nebo sourceType (job|tariff)." },
      { status: 400 }
    );
  }

  const todayIso = new Date().toISOString().split("T")[0];
  const nowMs = Date.now();

  try {
    const pinOk = await verifyAttendancePinForEmployee(db, companyId, employeeId, pin);
    if (!pinOk) {
      return NextResponse.json({ error: "Neplatný PIN." }, { status: 401 });
    }

    const byEmp = await loadTodayAttendanceEventsByEmployee(db, companyId, todayIso);
    const existing = byEmp.get(employeeId) ?? [];
    const shiftOpen = isShiftOpenFromSorted(existing);
    if (!shiftOpen) {
      return NextResponse.json(
        { error: "Nemáte otevřenou směnu — přepnutí zakázky je možné jen během práce." },
        { status: 409 }
      );
    }

    if (sourceType === "job") {
      const jobId = String(body.jobId || "").trim();
      if (!jobId) {
        return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
      }
      const empSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("employees")
        .doc(employeeId)
        .get();
      const assigned = Array.isArray(empSnap.data()?.assignedTerminalJobIds)
        ? (empSnap.data()!.assignedTerminalJobIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      if (!assigned.includes(jobId)) {
        return NextResponse.json({ error: "Tato zakázka není přiřazena k terminálu." }, { status: 403 });
      }
    } else {
      const tariffId = String(body.tariffId || "").trim();
      if (!tariffId) {
        return NextResponse.json({ error: "Chybí tariffId." }, { status: 400 });
      }
      const tSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("work_tariffs")
        .doc(tariffId)
        .get();
      const td = tSnap.data() as { active?: boolean } | undefined;
      if (!tSnap.exists || td?.active !== true) {
        return NextResponse.json({ error: "Tarif neexistuje nebo není aktivní." }, { status: 403 });
      }
    }

    const open = await findOpenWorkSegment(db, companyId, employeeId, todayIso);
    if (open) {
      const rate =
        typeof (open.data() as { hourlyRateCzk?: number }).hourlyRateCzk === "number"
          ? (open.data() as { hourlyRateCzk: number }).hourlyRateCzk
          : null;
      await closeWorkSegment(open.ref, nowMs, rate);
    }

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

    const newId = await createWorkSegment({
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

    if (sourceType === "job") {
      console.log("Employee selected job", { jobId });
    } else {
      console.log("Employee selected tariff", { tariffId });
    }

    const displayName =
      sourceType === "job"
        ? String(meta.jobName ?? jobId ?? "")
        : String(meta.tariffName ?? tariffId ?? "");
    return NextResponse.json({
      ok: true,
      segmentId: newId,
      activeSegment: {
        sourceType,
        jobId: sourceType === "job" ? jobId : null,
        jobName: sourceType === "job" ? String(meta.jobName ?? "") : "",
        tariffId: sourceType === "tariff" ? tariffId : null,
        tariffName: sourceType === "tariff" ? String(meta.tariffName ?? "") : "",
        displayName,
      },
    });
  } catch (e) {
    console.error("[attendance-login/switch-segment]", e);
    return NextResponse.json({ error: "Přepnutí se nezdařilo." }, { status: 500 });
  }
}
