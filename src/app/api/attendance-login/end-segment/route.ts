import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { loadTodayAttendanceEventsByEmployee } from "@/lib/attendance-day-server";
import { isShiftOpenFromSorted } from "@/lib/attendance-shift-state";
import { maybeAutoApproveJobSegmentAfterTerminalClose } from "@/lib/job-terminal-auto-approve";
import { closeWorkSegment, findOpenWorkSegment } from "@/lib/work-segment-server";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
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

  if (!companyId || !employeeId || !pin) {
    return NextResponse.json({ error: "Chybí companyId, employeeId nebo PIN." }, { status: 400 });
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
        { error: "Nemáte otevřenou směnu — nelze ukončit práci na zakázce." },
        { status: 409 }
      );
    }

    const open = await findOpenWorkSegment(db, companyId, employeeId, todayIso);
    if (!open) {
      return NextResponse.json({ ok: true, activeSegment: null });
    }

    const rate =
      typeof (open.data() as { hourlyRateCzk?: number }).hourlyRateCzk === "number"
        ? (open.data() as { hourlyRateCzk: number }).hourlyRateCzk
        : null;
    await closeWorkSegment(open.ref, nowMs, rate);
    await maybeAutoApproveJobSegmentAfterTerminalClose(db, companyId, open.ref, employeeId);

    console.log("Employee ended active job but remains checked in", { employeeId });

    return NextResponse.json({ ok: true, activeSegment: null });
  } catch (e) {
    console.error("[attendance-login/end-segment]", e);
    return NextResponse.json({ error: "Ukončení segmentu se nezdařilo." }, { status: 500 });
  }
}
