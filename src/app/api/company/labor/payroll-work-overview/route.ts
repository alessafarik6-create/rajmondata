import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  canViewOthersPayrollData,
  loadPayrollAccessContext,
} from "@/lib/labor/labor-payroll-access";
import { productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";
import {
  dateStrInRange,
  localDayKeyFromIsoTimestamp,
} from "@/lib/labor/employee-work-statement";
import {
  attendanceRowCalendarDateKey,
  getDayAttendanceSummaryForLocalDay,
  type AttendanceRow,
} from "@/lib/employee-attendance";

export const dynamic = "force-dynamic";

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return null;
}

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "labor",
    method: "GET",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const ctx = await loadPayrollAccessContext(v.db, v.caller);
  if (!canViewOthersPayrollData(ctx)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
  }

  const fromIso = String(request.nextUrl.searchParams.get("from") ?? "").trim().slice(0, 10);
  const toIso = String(request.nextUrl.searchParams.get("to") ?? "").trim().slice(0, 10);
  if (!fromIso || !toIso) {
    return NextResponse.json(
      { ok: false, error: "Chybí from a to (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const [empSnap, entriesSnap, attSnap] = await Promise.all([
    v.db.collection("companies").doc(v.caller.companyId).collection("employees").get(),
    productionTimeEntriesCol(v.db, v.caller.companyId).get(),
    v.db.collection("companies").doc(v.caller.companyId).collection("attendance").get(),
  ]);

  const attendanceAll = attSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as object) }) as AttendanceRow
  );

  const qrSecondsByEmp = new Map<string, number>();
  for (const doc of entriesSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const empId = String(d.employeeId ?? "");
    if (!empId || d.endedAt == null) continue;
    const started = tsToIso(d.startedAt);
    if (!started) continue;
    const day =
      String(d.workDateIso ?? "").slice(0, 10) || localDayKeyFromIsoTimestamp(started);
    if (!dateStrInRange(day, fromIso, toIso)) continue;
    const sec = typeof d.durationSeconds === "number" ? d.durationSeconds : 0;
    qrSecondsByEmp.set(empId, (qrSecondsByEmp.get(empId) ?? 0) + sec);
  }

  const rows: Array<{
    employeeId: string;
    displayName: string;
    attendanceHours: number;
    qrHours: number;
    unassignedHours: number;
    earningsKc: number | null;
    anomalyFlags: number;
  }> = [];

  for (const ed of empSnap.docs) {
    const e = ed.data() as Record<string, unknown>;
    const id = ed.id;
    const name =
      `${String(e.firstName ?? "")} ${String(e.lastName ?? "")}`.trim() ||
      String(e.email ?? id);
    const authUid =
      typeof e.authUserId === "string" && e.authUserId.trim()
        ? e.authUserId.trim()
        : null;
    const rate = Number(e.hourlyRate ?? 0);

    let attHours = 0;
    const dayKeys = new Set<string>();
    for (const r of attendanceAll) {
      const eid = String(r.employeeId ?? "");
      if (!(eid === id || (authUid && eid === authUid))) continue;
      const dk = attendanceRowCalendarDateKey(r);
      if (dk && dateStrInRange(dk, fromIso, toIso)) dayKeys.add(dk);
    }
    for (const dk of dayKeys) {
      const { summary } = getDayAttendanceSummaryForLocalDay(attendanceAll, dk, {
        employeeId: id,
        authUid: authUid ?? undefined,
      });
      if (summary?.hoursWorked) attHours += summary.hoursWorked;
    }
    attHours = Math.round(attHours * 100) / 100;
    const qrH = Math.round(((qrSecondsByEmp.get(id) ?? 0) / 3600) * 100) / 100;
    const unassigned = Math.max(0, Math.round((attHours - qrH) * 100) / 100);
    let flags = 0;
    if (qrH > 0 && attHours < 0.08) flags++;
    if (attHours > 0.08 && qrH + 0.08 < attHours) flags++;

    rows.push({
      employeeId: id,
      displayName: name,
      attendanceHours: attHours,
      qrHours: qrH,
      unassignedHours: unassigned,
      earningsKc:
        Number.isFinite(rate) && rate > 0
          ? Math.round(attHours * rate * 100) / 100
          : null,
      anomalyFlags: flags,
    });
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "cs"));

  return NextResponse.json({ ok: true, fromIso, toIso, rows });
}
