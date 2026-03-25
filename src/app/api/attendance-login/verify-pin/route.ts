import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { loadTodayAttendanceEventsByEmployee } from "@/lib/attendance-day-server";
import { isShiftOpenFromSorted } from "@/lib/attendance-shift-state";
import { findOpenWorkSegment } from "@/lib/work-segment-server";
import { workSegmentDataToTerminalActiveSegment } from "@/lib/terminal-active-segment";

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
  const pinRaw = body.pin != null ? String(body.pin) : "";
  const pin = normalizeTerminalPin(pinRaw);

  if (!companyId || !employeeId || !pin) {
    return NextResponse.json({ ok: false, error: "Chybí companyId, employeeId nebo PIN." }, { status: 400 });
  }

  const todayIso = new Date().toISOString().split("T")[0];

  try {
    const ok = await verifyAttendancePinForEmployee(db, companyId, employeeId, pin);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Neplatný PIN." }, { status: 401 });
    }

    const byEmp = await loadTodayAttendanceEventsByEmployee(db, companyId, todayIso);
    const ev = byEmp.get(employeeId) ?? [];
    const inWork = isShiftOpenFromSorted(ev);

    let activeSegment: ReturnType<typeof workSegmentDataToTerminalActiveSegment> | null = null;
    if (inWork) {
      const open = await findOpenWorkSegment(db, companyId, employeeId, todayIso);
      if (open) {
        activeSegment = workSegmentDataToTerminalActiveSegment(open.data() as Record<string, unknown>);
      }
    }

    console.log(
      `Employee status resolved: ${inWork ? "in work" : "out of work"} (${employeeId})`
    );

    return NextResponse.json({
      ok: true,
      inWork,
      activeSegment,
    });
  } catch (e) {
    console.error("[attendance-login/verify-pin]", e);
    return NextResponse.json({ error: "Ověření se nezdařilo." }, { status: 500 });
  }
}
