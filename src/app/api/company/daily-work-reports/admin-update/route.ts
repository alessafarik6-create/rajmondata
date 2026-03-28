import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { parseHourlyRate } from "@/lib/attendance-shift-state";
import {
  buildSegmentAllocationsFromAdminSplits,
  type AdminPatchSplitRow,
  parseAdminPatchSplits,
  primaryJobFromSplits,
  sumSplitHours,
} from "@/lib/daily-work-report-admin-patch";
import {
  deleteWorkReportLaborJobExpenses,
  syncApprovedWorkReportLaborJobExpenses,
} from "@/lib/daily-work-report-job-labor-expenses";
import { applyApprovedJobLaborFromSegments } from "@/lib/work-segment-server";
import { sumAutoJobTerminalBlockPayableCzkForDay } from "@/lib/job-terminal-auto-approve";
import { estimateLaborFromJobSplits, type SegmentJobSplitOut } from "@/lib/daily-work-report-resolve";

type Body = {
  companyId?: string;
  employeeId?: string;
  date?: string;
  action?: "save" | "deleteReport";
  segmentJobSplits?: unknown;
  note?: string | null;
  description?: string | null;
};

function reportDocId(employeeId: string, date: string) {
  return `${employeeId}__${date}`;
}

function splitsToFirestorePayload(splits: AdminPatchSplitRow[]) {
  return splits.map((s) => {
    const o: Record<string, unknown> = {
      segmentType: s.segmentType,
      segmentId: s.segmentId,
      jobId: s.jobId,
      jobName: s.jobName,
      hours: s.hours,
    };
    if (s.lineNote && String(s.lineNote).trim()) {
      o.lineNote = String(s.lineNote).trim().slice(0, 4000);
    }
    return o;
  });
}

/**
 * Úprava / smazání denního výkazu administrátorem (owner / admin / manager / účetní).
 * Při schváleném výkazu přepočítá náklady zakázky z ručních řádků a podklad k výplatě.
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
  const action = body.action === "deleteReport" ? "deleteReport" : "save";

  if (!companyId || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Chybí platné údaje výkazu." }, { status: 400 });
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

    if (action === "deleteReport") {
      const prevLaborLinks = report.workReportLaborExpenseLinks as
        | { jobId?: string; expenseId?: string }[]
        | undefined;
      await deleteWorkReportLaborJobExpenses(
        db,
        companyId,
        Array.isArray(prevLaborLinks)
          ? prevLaborLinks
              .filter((x) => x && typeof x.jobId === "string" && typeof x.expenseId === "string")
              .map((x) => ({ jobId: x.jobId!, expenseId: x.expenseId! }))
          : undefined
      );
      await ref.delete();
      return NextResponse.json({ ok: true, deleted: true });
    }

    const parsed = parseAdminPatchSplits(body.segmentJobSplits);
    if (!parsed) {
      return NextResponse.json(
        { error: "Neplatné řádky výkazu — očekává se neprázdné pole segmentJobSplits s hodinami a typem řádku." },
        { status: 400 }
      );
    }

    const hoursSum = sumSplitHours(parsed);
    const segmentAllocations = buildSegmentAllocationsFromAdminSplits(parsed);
    const { primaryJobId, primaryJobName } = primaryJobFromSplits(parsed);

    const empSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    const empData = empSnap.data() as Record<string, unknown> | undefined;
    if (!empData) {
      return NextResponse.json({ error: "Záznam zaměstnance neexistuje." }, { status: 404 });
    }

    const forEstimate: SegmentJobSplitOut[] = parsed.map((s) => ({
      segmentId: s.segmentId,
      segmentType: s.segmentType,
      jobId: s.jobId,
      jobName: s.jobName,
      hours: s.hours,
    }));

    let estimatedLaborFromSegmentsCzk = 0;
    try {
      estimatedLaborFromSegmentsCzk = await estimateLaborFromJobSplits(
        db,
        companyId,
        empData,
        forEstimate
      );
    } catch {
      estimatedLaborFromSegmentsCzk = 0;
    }

    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 8000) : String(report.note ?? "").trim();
    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 16000)
        : String(report.description ?? "").trim();

    const status = typeof report.status === "string" ? report.status : "";
    const fsSplits = splitsToFirestorePayload(parsed);

    const baseUpdate: Record<string, unknown> = {
      segmentJobSplits: fsSplits,
      segmentAllocations,
      jobId: primaryJobId,
      jobName: primaryJobName,
      hoursFromAttendance: hoursSum,
      hoursConfirmed: hoursSum,
      note: note || FieldValue.delete(),
      description: description || FieldValue.delete(),
      estimatedLaborFromSegmentsCzk:
        estimatedLaborFromSegmentsCzk > 0 ? estimatedLaborFromSegmentsCzk : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (status === "approved") {
      const hourlyRate = parseHourlyRate(empData?.hourlyRate) ?? 0;
      const prevLaborLinks = report.workReportLaborExpenseLinks as
        | { jobId?: string; expenseId?: string }[]
        | undefined;

      await deleteWorkReportLaborJobExpenses(
        db,
        companyId,
        Array.isArray(prevLaborLinks)
          ? prevLaborLinks
              .filter((x) => x && typeof x.jobId === "string" && typeof x.expenseId === "string")
              .map((x) => ({ jobId: x.jobId!, expenseId: x.expenseId! }))
          : undefined
      );

      const mergedReport = { ...report, ...baseUpdate, segmentJobSplits: fsSplits };
      const laborLinks = await syncApprovedWorkReportLaborJobExpenses({
        db,
        companyId,
        reportDocId: rid,
        report: mergedReport,
        employeeHourlyRateCzk: hourlyRate,
        createdByUid: callerUid,
      });

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
      const hoursForPay = hoursSum;
      const fallbackPay =
        Number.isFinite(hourlyRate) && hourlyRate > 0 && hoursForPay > 0
          ? Math.round(hoursForPay * hourlyRate * 100) / 100
          : 0;
      const payableAmountCzk =
        totalClosedSegmentPayCzk > 0
          ? totalClosedSegmentPayCzk
          : autoTerminalPayCzk > 0
            ? 0
            : fallbackPay;

      await ref.update({
        ...baseUpdate,
        payableAmountCzk,
        payableHoursSnapshot: hoursForPay,
        hourlyRateSnapshot: hourlyRate > 0 ? hourlyRate : FieldValue.delete(),
        segmentPayTotalCzk:
          totalClosedSegmentPayCzk > 0 ? totalClosedSegmentPayCzk : FieldValue.delete(),
        workReportLaborExpenseLinks: laborLinks.length > 0 ? laborLinks : [],
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedByUid: callerUid,
        reviewedByName: reviewerName,
      });
    } else {
      await ref.update(baseUpdate);
    }

    return NextResponse.json({ ok: true, id: rid, hoursSum });
  } catch (e) {
    console.error("[company/daily-work-reports/admin-update]", e);
    return NextResponse.json({ error: "Aktualizace se nezdařila." }, { status: 500 });
  }
}
