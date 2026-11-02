import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  canViewOthersPayrollData,
  isSelfPayrollOnlyUser,
  loadPayrollAccessContext,
} from "@/lib/labor/labor-payroll-access";
import { loadEmployeeWorkStatement } from "@/lib/labor/employee-work-statement-server";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import { dateStrInRange } from "@/lib/labor/employee-work-statement";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "labor",
    method: "GET",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const url = new URL(request.url);
  const employeeId = String(url.searchParams.get("employeeId") ?? "").trim();
  const fromIso = String(url.searchParams.get("from") ?? "").trim().slice(0, 10);
  const toIso = String(url.searchParams.get("to") ?? "").trim().slice(0, 10);
  if (!employeeId || !fromIso || !toIso) {
    return NextResponse.json(
      { ok: false, error: "Chybí employeeId, from nebo to (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const ctx = await loadPayrollAccessContext(v.db, v.caller);
  const selfOnly = isSelfPayrollOnlyUser(ctx);
  if (selfOnly && ctx.employeeId !== employeeId) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
  }
  if (!selfOnly && !canViewOthersPayrollData(ctx) && ctx.employeeId !== employeeId) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
  }

  const empSnap = await v.db
    .collection("companies")
    .doc(v.caller.companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  if (!empSnap.exists) {
    return NextResponse.json({ ok: false, error: "Zaměstnanec nenalezen." }, { status: 404 });
  }
  const emp = empSnap.data() as Record<string, unknown>;
  const authUid =
    typeof emp.authUserId === "string" && emp.authUserId.trim()
      ? emp.authUserId.trim()
      : null;
  const hourlyRate = Number(emp.hourlyRate ?? 0);
  const includeMoney = selfOnly || canViewOthersPayrollData(ctx);

  const [attSnap, repSnap, segSnap] = await Promise.all([
    v.db.collection("companies").doc(v.caller.companyId).collection("attendance").get(),
    v.db
      .collection("companies")
      .doc(v.caller.companyId)
      .collection("daily_work_reports")
      .where("employeeId", "==", employeeId)
      .get(),
    v.db.collection("companies").doc(v.caller.companyId).collection("work_segments").get(),
  ]);

  const attendanceRows = attSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as AttendanceRow)
    .filter((r) => {
      const eid = String(r.employeeId ?? "");
      return eid === employeeId || (authUid && eid === authUid);
    });

  const dailyReports = repSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((r) => {
      const dk = String(r.date ?? "").slice(0, 10);
      return dateStrInRange(dk, fromIso, toIso);
    });

  const workSegments = segSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as WorkSegmentClient)
    .filter((s) => {
      const eid = String(s.employeeId ?? "");
      return eid === employeeId || (authUid && eid === authUid);
    });

  const statement = await loadEmployeeWorkStatement({
    db: v.db,
    companyId: v.caller.companyId,
    employeeId,
    employeeAuthUid: authUid,
    fromIso,
    toIso,
    hourlyRateCzk: hourlyRate,
    includeMoney,
    attendanceRows,
    dailyReports,
    workSegments,
  });

  return NextResponse.json({
    ok: true,
    employeeId,
    fromIso,
    toIso,
    includeMoney,
    ...statement,
  });
}
