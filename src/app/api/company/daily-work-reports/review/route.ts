import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { parseHourlyRate } from "@/lib/attendance-shift-state";
import { sumAutoJobTerminalBlockPayableCzkForDay } from "@/lib/job-terminal-auto-approve";
import {
  deleteWorkReportLaborJobExpenses,
  syncApprovedWorkReportLaborJobExpenses,
} from "@/lib/daily-work-report-job-labor-expenses";
import { applyApprovedJobLaborFromSegments } from "@/lib/work-segment-server";
import { dispatchOrgModuleEmail } from "@/lib/email-notifications/dispatch";

type Body = {
  companyId?: string;
  employeeId?: string;
  date?: string;
  action?: "approve" | "reject" | "return";
  adminNote?: string | null;
};

function reportDocId(employeeId: string, date: string) {
  return `${employeeId}__${date}`;
}

/**
 * Schválení / zamítnutí / vrácení denního výkazu — owner / admin / manager / účetní.
 * Při schválení se uloží payableAmountCzk (podklad k výplatě).
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId || "").trim();
  const employeeId = String(body.employeeId || "").trim();
  const date = String(body.date || "").trim();
  const action = body.action;

  if (!companyId || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Chybí platné údaje výkazu." }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject" && action !== "return") {
    return NextResponse.json({ error: "Neplatná akce." }, { status: 400 });
  }

  try {
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const caller = callerSnap.data() as Record<string, unknown> | undefined;
    if (!caller) {
      return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
    }
    const callerCompany = String(caller.companyId || "").trim();
    const callerRole = String(caller.role || "");
    const globalRoles = caller.globalRoles as string[] | undefined;
    const isSuper = Array.isArray(globalRoles) && globalRoles.includes("super_admin");
    const privileged =
      isSuper || ["owner", "admin", "manager", "accountant"].includes(callerRole);

    if (!privileged || callerCompany !== companyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }

    const reviewerName =
      String(caller.displayName || "").trim() ||
      String(caller.email || "").trim() ||
      callerUid;

    const rid = reportDocId(employeeId, date);
    const ref = db
      .collection("companies")
      .doc(companyId)
      .collection("daily_work_reports")
      .doc(rid);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Výkaz neexistuje." }, { status: 404 });
    }

    const report = snap.data() as Record<string, unknown>;
    const prevLaborLinks = report.workReportLaborExpenseLinks as
      | { jobId?: string; expenseId?: string }[]
      | undefined;
    const adminNote =
      typeof body.adminNote === "string" && body.adminNote.trim() ? body.adminNote.trim() : null;

    const empSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    const empData = empSnap.data() as Record<string, unknown> | undefined;
    const hourlyRate = parseHourlyRate(empData?.hourlyRate) ?? 0;
    const employeeDisplayName =
      `${String(empData?.firstName ?? "").trim()} ${String(empData?.lastName ?? "").trim()}`.trim() ||
      employeeId;

    const hoursConfirmed =
      typeof report.hoursConfirmed === "number" && Number.isFinite(report.hoursConfirmed)
        ? (report.hoursConfirmed as number)
        : null;
    const hoursFromAtt =
      typeof report.hoursFromAttendance === "number" && Number.isFinite(report.hoursFromAttendance)
        ? (report.hoursFromAttendance as number)
        : null;
    const hoursForPay = hoursConfirmed ?? hoursFromAtt ?? 0;

    if (action === "approve") {
      const fallbackPay =
        Number.isFinite(hourlyRate) && hourlyRate > 0 && hoursForPay > 0
          ? Math.round(hoursForPay * hourlyRate * 100) / 100
          : 0;

      const { totalClosedSegmentPayCzk } = await applyApprovedJobLaborFromSegments(
        db,
        companyId,
        employeeId,
        date,
        rid
      );
      const autoTerminalPayCzk = await sumAutoJobTerminalBlockPayableCzkForDay(
        db,
        companyId,
        employeeId,
        date
      );
      const payableAmountCzk =
        totalClosedSegmentPayCzk > 0
          ? totalClosedSegmentPayCzk
          : autoTerminalPayCzk > 0
            ? 0
            : fallbackPay;

      await deleteWorkReportLaborJobExpenses(
        db,
        companyId,
        Array.isArray(prevLaborLinks)
          ? prevLaborLinks
              .filter((x) => x && typeof x.jobId === "string" && typeof x.expenseId === "string")
              .map((x) => ({ jobId: x.jobId!, expenseId: x.expenseId! }))
          : undefined
      );

      const laborLinks = await syncApprovedWorkReportLaborJobExpenses({
        db,
        companyId,
        reportDocId: rid,
        report,
        employeeHourlyRateCzk: hourlyRate,
        createdByUid: callerUid,
      });

      await ref.update({
        status: "approved",
        payableAmountCzk,
        payableHoursSnapshot: hoursForPay,
        hourlyRateSnapshot: hourlyRate > 0 ? hourlyRate : FieldValue.delete(),
        segmentPayTotalCzk:
          totalClosedSegmentPayCzk > 0 ? totalClosedSegmentPayCzk : FieldValue.delete(),
        workReportLaborExpenseLinks: laborLinks.length > 0 ? laborLinks : [],
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedByUid: callerUid,
        reviewedByName: reviewerName,
        adminNote: adminNote ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        await dispatchOrgModuleEmail(db, {
          companyId,
          module: "attendance",
          eventKey: "payrollApproved",
          entityId: rid,
          title: `Denní výkaz schválen (${date})`,
          lines: [
            `Zaměstnanec: ${employeeDisplayName}`,
            `Schválil: ${reviewerName}`,
            typeof payableAmountCzk === "number"
              ? `Částka k výplatě: ${payableAmountCzk} Kč`
              : "",
          ].filter(Boolean),
          actionPath: "/portal/labor/dochazka?tab=approvals",
        });
      } catch (emailErr) {
        console.warn("[daily-work-reports/review] email notify skipped", emailErr);
      }

      console.log("Daily work report approved by admin");
    } else if (action === "reject") {
      await deleteWorkReportLaborJobExpenses(
        db,
        companyId,
        Array.isArray(prevLaborLinks)
          ? prevLaborLinks
              .filter((x) => x && typeof x.jobId === "string" && typeof x.expenseId === "string")
              .map((x) => ({ jobId: x.jobId!, expenseId: x.expenseId! }))
          : undefined
      );

      await ref.update({
        status: "rejected",
        payableAmountCzk: FieldValue.delete(),
        payableHoursSnapshot: FieldValue.delete(),
        hourlyRateSnapshot: FieldValue.delete(),
        workReportLaborExpenseLinks: FieldValue.delete(),
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedByUid: callerUid,
        reviewedByName: reviewerName,
        adminNote: adminNote ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log("Daily work report rejected by admin");
    } else {
      await deleteWorkReportLaborJobExpenses(
        db,
        companyId,
        Array.isArray(prevLaborLinks)
          ? prevLaborLinks
              .filter((x) => x && typeof x.jobId === "string" && typeof x.expenseId === "string")
              .map((x) => ({ jobId: x.jobId!, expenseId: x.expenseId! }))
          : undefined
      );

      await ref.update({
        status: "returned",
        payableAmountCzk: FieldValue.delete(),
        payableHoursSnapshot: FieldValue.delete(),
        hourlyRateSnapshot: FieldValue.delete(),
        workReportLaborExpenseLinks: FieldValue.delete(),
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedByUid: callerUid,
        reviewedByName: reviewerName,
        adminNote: adminNote ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log("Daily work report returned for revision by admin");
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[company/daily-work-reports/review]", e);
    return NextResponse.json({ error: "Aktualizace se nezdařila." }, { status: 500 });
  }
}
