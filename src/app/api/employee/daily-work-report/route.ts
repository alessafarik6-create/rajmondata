import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { sendModuleNotification } from "@/lib/email-notifications/module-notify";
import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  isLegacyVirtualManualSegmentId,
} from "@/lib/daily-work-report-constants";
import {
  estimateLaborFromJobSplits,
  resolveAttendanceOnlyJobSplits,
  resolveSegmentJobSplits,
  resolveTerminalPlusManualJobSplits,
} from "@/lib/daily-work-report-resolve";
import { isDailyReportPastEditDeadline } from "@/lib/daily-report-24h-lock";

type Body = {
  companyId?: string;
  date?: string;
  description?: string;
  note?: string;
  jobId?: string | null;
  jobName?: string | null;
  hoursFromAttendance?: number | null;
  hoursConfirmed?: number | null;
  /** @deprecated použijte segmentJobSplits */
  segmentAllocations?: Array<{ segmentId?: string; jobId?: string }>;
  /** Rozdělení hodin mezi zakázky po uzavřených úsecích terminálu. */
  segmentJobSplits?: Array<{
    segmentId?: string | null;
    segmentType?: string;
    jobId?: string | null;
    hours?: unknown;
  }>;
  /** Alias pro segmentJobSplits (stejný formát). */
  rows?: Array<{
    segmentId?: string | null;
    segmentType?: string;
    jobId?: string | null;
    hours?: unknown;
  }>;
  /** Volitelné poznámky k řádkům hlavního denního formuláře (odpovídají pořadí řádků u odemčených úseků). */
  dayWorkLines?: Array<{ lineNote?: string }>;
  /** Poznámky k uzamčeným úsekům (segmentId → text), např. tarif nebo zakázka z terminálu. */
  segmentLineNotes?: Record<string, string>;
  /** `draft` = rozpracováno, `submit` = odeslat ke schválení */
  mode?: "draft" | "submit";
};

type NormalizedSplitRow =
  | { kind: "manual"; jobId: string; hours: number }
  | { kind: "terminal"; segmentId: string; jobId: string; hours: number };

/** Hodiny z klienta: číslo, řetězec „1,5“ / „1.5“; Firestore nesmí dostat NaN ani undefined. */
function parseHoursField(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Sjednotí řádky výkazu před validací (segmentJobSplits nebo alias rows).
 * Ruční řádky: segmentType „manual“, případně prázdný segmentId; terminál: segmentId z work_segments.
 * Staré klienty: virtuální segmentId (legacy) se bere jako ruční řádek.
 */
function normalizeSegmentJobSplitsFromBody(raw: unknown, label: string): NormalizedSplitRow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `Chybí pole ${label} — očekává se neprázdné pole řádků (segmentId / segmentType, jobId, hours).`
    );
  }
  const out: NormalizedSplitRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Řádek ${i + 1}: neplatná struktura (očekává se objekt).`);
    }
    const row = item as Record<string, unknown>;
    const stRaw = String(row.segmentType ?? "").trim();
    const sidRaw = row.segmentId;
    const segmentId =
      sidRaw === null || sidRaw === undefined ? "" : String(sidRaw).trim();
    const legacyManual = isLegacyVirtualManualSegmentId(segmentId);

    if (stRaw === DAILY_REPORT_ROW_SOURCE_TERMINAL && !segmentId) {
      throw new Error(`Řádek ${i + 1}: u řádku z terminálu je povinný segmentId.`);
    }

    const manual =
      stRaw === DAILY_REPORT_ROW_SOURCE_MANUAL ||
      legacyManual ||
      (segmentId === "" && stRaw !== DAILY_REPORT_ROW_SOURCE_TERMINAL);

    const jobIdRaw = row.jobId;
    const jobId =
      jobIdRaw === null || jobIdRaw === undefined ? "" : String(jobIdRaw).trim();
    const hoursNum = parseHoursField(row.hours);
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      throw new Error(
        `Řádek ${i + 1}: neplatný počet hodin — zadejte kladné číslo (např. 1,5 nebo 1.5).`
      );
    }
    const hours = Math.round(hoursNum * 100) / 100;

    if (manual) {
      if (stRaw === DAILY_REPORT_ROW_SOURCE_MANUAL && segmentId && !legacyManual) {
        throw new Error(
          `Řádek ${i + 1}: u ruční práce (segmentType „${DAILY_REPORT_ROW_SOURCE_MANUAL}“) neuvedujte segmentId z terminálu.`
        );
      }
      out.push({ kind: "manual", jobId, hours });
      continue;
    }

    if (!segmentId) {
      throw new Error(
        `Řádek ${i + 1}: chybí segmentId nebo pro ruční práci uveďte segmentType „${DAILY_REPORT_ROW_SOURCE_MANUAL}“.`
      );
    }

    if (stRaw === "" || stRaw === DAILY_REPORT_ROW_SOURCE_TERMINAL) {
      out.push({ kind: "terminal", segmentId, jobId, hours });
      continue;
    }

    throw new Error(
      `Řádek ${i + 1}: neznámý segmentType „${stRaw}“. Použijte „${DAILY_REPORT_ROW_SOURCE_MANUAL}“ nebo „${DAILY_REPORT_ROW_SOURCE_TERMINAL}“.`
    );
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Firestore Admin SDK odmítá hodnoty `undefined`; FieldValue neprochází rekurzí. */
function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null) return value;
  if (value instanceof FieldValue) return value;
  if (Array.isArray(value)) {
    return value.map((x) => stripUndefinedDeep(x)) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
}

function reportDocId(employeeId: string, date: string) {
  return `${employeeId}__${date}`;
}

/**
 * Zaměstnanec uloží denní výkaz (koncept nebo odeslání ke schválení).
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
  const date = String(body.date || "").trim();
  const descriptionRaw = typeof body.description === "string" ? body.description.trim() : "";
  const mode = body.mode === "draft" ? "draft" : "submit";

  if (!companyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Chybí platné companyId nebo datum (YYYY-MM-DD)." }, { status: 400 });
  }
  if (mode === "submit" && !descriptionRaw) {
    return NextResponse.json({ error: "Pro odeslání ke schválení vyplňte popis práce." }, { status: 400 });
  }

  try {
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const caller = callerSnap.data() as Record<string, unknown> | undefined;
    if (!caller) {
      return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
    }
    const callerCompany = String(caller.companyId || "").trim();
    const callerRole = String(caller.role || "");
    const employeeId = String(caller.employeeId || "").trim();
    const globalRoles = caller.globalRoles as string[] | undefined;
    const isSuper = Array.isArray(globalRoles) && globalRoles.includes("super_admin");
    const privileged =
      isSuper || ["owner", "admin", "manager", "accountant"].includes(callerRole);

    if (privileged) {
      return NextResponse.json(
        { error: "Denní výkaz ukládají zaměstnanci — použijte běžný zaměstnanecký účet." },
        { status: 403 }
      );
    }
    if (callerCompany !== companyId || !employeeId) {
      return NextResponse.json({ error: "Nemáte přístup k této firmě nebo chybí employeeId." }, { status: 403 });
    }

    const empSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    if (!empSnap.exists) {
      return NextResponse.json({ error: "Záznam zaměstnance neexistuje." }, { status: 404 });
    }
    const emp = empSnap.data() as Record<string, unknown>;
    if (emp.enableDailyWorkLog === false) {
      return NextResponse.json(
        { error: "Administrátor vypnul funkci denní výkaz práce." },
        { status: 403 }
      );
    }

    const employeeName =
      `${String(emp.firstName ?? "").trim()} ${String(emp.lastName ?? "").trim()}`.trim() ||
      String(caller.displayName || caller.email || employeeId);

    const rid = reportDocId(employeeId, date);
    const ref = db
      .collection("companies")
      .doc(companyId)
      .collection("daily_work_reports")
      .doc(rid);

    const existing = await ref.get();
    const prev = existing.data() as Record<string, unknown> | undefined;
    const prevStatus = typeof prev?.status === "string" ? prev.status : "";

    if (prevStatus === "approved") {
      return NextResponse.json({ error: "Schválený výkaz nelze měnit." }, { status: 409 });
    }
    if (prevStatus === "pending") {
      return NextResponse.json(
        { error: "Výkaz čeká na schválení. Úpravy jsou možné až po vrácení nebo zamítnutí." },
        { status: 409 }
      );
    }

    const companySnap = await db.collection("companies").doc(companyId).get();
    const enableDailyReport24hLock =
      (companySnap.data() as { enableDailyReport24hLock?: boolean } | undefined)
        ?.enableDailyReport24hLock === true;
    if (
      enableDailyReport24hLock &&
      prevStatus !== "returned" &&
      isDailyReportPastEditDeadline(date)
    ) {
      return NextResponse.json(
        { error: "Zápis je uzamčen po 24 hodinách." },
        { status: 403 }
      );
    }

    const note = typeof body.note === "string" ? body.note.trim() : "";
    const dayWorkLines = Array.isArray(body.dayWorkLines)
      ? body.dayWorkLines.map((x) => ({
          lineNote:
            typeof (x as { lineNote?: string }).lineNote === "string"
              ? String((x as { lineNote?: string }).lineNote).trim()
              : "",
        }))
      : null;

    let segmentLineNotesPayload: Record<string, string> | undefined;
    if (
      body.segmentLineNotes !== undefined &&
      body.segmentLineNotes !== null &&
      typeof body.segmentLineNotes === "object" &&
      !Array.isArray(body.segmentLineNotes)
    ) {
      segmentLineNotesPayload = Object.fromEntries(
        Object.entries(body.segmentLineNotes as Record<string, unknown>).map(([k, v]) => [
          String(k).trim(),
          typeof v === "string" ? v.trim() : "",
        ])
      );
    }

    const splitsSource =
      Array.isArray(body.segmentJobSplits) && body.segmentJobSplits.length > 0
        ? body.segmentJobSplits
        : Array.isArray(body.rows) && body.rows.length > 0
          ? body.rows
          : null;

    let normalizedSplits: NormalizedSplitRow[];
    try {
      if (!splitsSource) {
        throw new Error(
          "Chybí rozdělení času (segmentJobSplits nebo rows). Aktualizujte prosím stránku denního výkazu."
        );
      }
      normalizedSplits = normalizeSegmentJobSplitsFromBody(
        splitsSource,
        splitsSource === body.rows ? "rows" : "segmentJobSplits"
      );
    } catch (normErr) {
      const msg = normErr instanceof Error ? normErr.message : "Neplatné řádky výkazu.";
      console.warn("[employee/daily-work-report] normalize segmentJobSplits failed", {
        companyId,
        employeeId,
        date,
        message: msg,
      });
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const manualRows = normalizedSplits
      .filter((r): r is Extract<NormalizedSplitRow, { kind: "manual" }> => r.kind === "manual")
      .map((r) => ({ jobId: r.jobId, hours: r.hours }));
    const terminalRows = normalizedSplits
      .filter((r): r is Extract<NormalizedSplitRow, { kind: "terminal" }> => r.kind === "terminal")
      .map((r) => ({ segmentId: r.segmentId, jobId: r.jobId, hours: r.hours }));

    let resolved: Awaited<ReturnType<typeof resolveSegmentJobSplits>>;
    try {
      if (terminalRows.length === 0) {
        resolved = await resolveAttendanceOnlyJobSplits(
          db,
          companyId,
          employeeId,
          callerUid,
          date,
          emp,
          manualRows,
          mode
        );
      } else if (manualRows.length === 0) {
        resolved = await resolveSegmentJobSplits(
          db,
          companyId,
          employeeId,
          date,
          callerUid,
          emp,
          terminalRows.map((r) => ({ segmentId: r.segmentId, jobId: r.jobId, hours: r.hours })),
          mode
        );
      } else {
        resolved = await resolveTerminalPlusManualJobSplits(
          db,
          companyId,
          employeeId,
          callerUid,
          date,
          emp,
          terminalRows,
          manualRows,
          mode
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Neplatná data výkazu.";
      console.warn("[employee/daily-work-report] resolve splits failed", {
        companyId,
        employeeId,
        date,
        message: msg,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { hoursSum, segmentJobSplits, segmentAllocations, primaryJobId, primaryJobName } = resolved;
    const jobId = primaryJobId;
    const jobName = primaryJobName;
    const hoursFromAttendance: number | null = hoursSum;
    const hoursConfirmed: number | null = hoursSum;

    const clearPayable = {
      payableAmountCzk: FieldValue.delete(),
      payableHoursSnapshot: FieldValue.delete(),
      hourlyRateSnapshot: FieldValue.delete(),
    };

    let estimatedLaborFromSegmentsCzk = 0;
    try {
      estimatedLaborFromSegmentsCzk = await estimateLaborFromJobSplits(
        db,
        companyId,
        emp,
        segmentJobSplits
      );
    } catch (laborErr) {
      console.error("[employee/daily-work-report] estimateLaborFromJobSplits failed", {
        message: laborErr instanceof Error ? laborErr.message : String(laborErr),
        stack: laborErr instanceof Error ? laborErr.stack : undefined,
        companyId,
        employeeId,
        date,
        rid,
      });
      estimatedLaborFromSegmentsCzk = 0;
    }

    const payloadBase = {
      companyId,
      employeeId,
      employeeName,
      date,
      description: descriptionRaw,
      note,
      jobId,
      jobName,
      segmentAllocations,
      segmentJobSplits,
      ...(dayWorkLines !== null ? { dayWorkLines } : {}),
      ...(segmentLineNotesPayload !== undefined ? { segmentLineNotes: segmentLineNotesPayload } : {}),
      hoursFromAttendance,
      hoursConfirmed,
      estimatedLaborFromSegmentsCzk:
        estimatedLaborFromSegmentsCzk > 0 ? estimatedLaborFromSegmentsCzk : FieldValue.delete(),
      ...clearPayable,
      reviewedAt: null,
      reviewedByUid: null,
      reviewedByName: null,
      adminNote: null,
    };

    console.info("[employee/daily-work-report] saving", {
      rid,
      companyId,
      employeeId,
      callerUid,
      date,
      mode,
      statusTarget: mode === "draft" ? "draft" : "pending",
      normalizedSplits,
      resolvedSegmentJobSplits: segmentJobSplits,
      dayWorkLinesCount: dayWorkLines?.length ?? 0,
      segmentLineNotesKeyCount: segmentLineNotesPayload
        ? Object.keys(segmentLineNotesPayload).length
        : 0,
      descriptionLen: descriptionRaw.length,
      noteLen: note.length,
    });

    if (mode === "draft") {
      try {
        await ref.set(
          stripUndefinedDeep({
            ...payloadBase,
            status: "draft",
            updatedAt: FieldValue.serverTimestamp(),
            submittedAt: FieldValue.delete(),
          }),
          { merge: true }
        );
      } catch (writeErr) {
        console.error("[employee/daily-work-report] Firestore set (draft) failed", {
          message: writeErr instanceof Error ? writeErr.message : String(writeErr),
          stack: writeErr instanceof Error ? writeErr.stack : undefined,
          rid,
          companyId,
          employeeId,
          date,
        });
        return NextResponse.json(
          {
            error:
              writeErr instanceof Error
                ? `Uložení konceptu se nezdařilo: ${writeErr.message}`
                : "Uložení konceptu se nezdařilo.",
          },
          { status: 500 }
        );
      }
      console.log("[employee/daily-work-report] draft saved", { rid });
      return NextResponse.json({ ok: true, id: rid });
    }

    try {
      await ref.set(
        stripUndefinedDeep({
          ...payloadBase,
          status: "pending",
          submittedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
        { merge: true }
      );
    } catch (writeErr) {
      console.error("[employee/daily-work-report] Firestore set (submit) failed", {
        message: writeErr instanceof Error ? writeErr.message : String(writeErr),
        stack: writeErr instanceof Error ? writeErr.stack : undefined,
        rid,
        companyId,
        employeeId,
        date,
      });
      return NextResponse.json(
        {
          error:
            writeErr instanceof Error
              ? `Odeslání výkazu se nezdařilo: ${writeErr.message}`
              : "Odeslání výkazu se nezdařilo.",
        },
        { status: 500 }
      );
    }

    console.log("[employee/daily-work-report] submitted", { rid });

    try {
      const actCol = db.collection("companies").doc(companyId).collection("employee_activities");
      const msgParts = [
        `${employeeName} odeslal(a) denní výkaz za ${date} ke schválení.`,
        jobName ? `Zakázka: ${jobName}.` : null,
      ].filter(Boolean);
      await actCol.add(
        stripUndefinedDeep({
          organizationId: companyId,
          employeeUserId: callerUid,
          employeeName: employeeName || null,
          type: "worklog_submitted",
          category: "worklog_submitted",
          title: "Výkaz práce ke schválení",
          message: msgParts.join(" "),
          jobId: jobId || null,
          jobName: jobName || null,
          dailyWorkReportId: rid,
          targetLink: "/portal/labor/dochazka?tab=approvals",
          createdAt: FieldValue.serverTimestamp(),
          resolved: false,
          resolvedAt: null,
          resolvedBy: null,
        })
      );
    } catch (activityErr) {
      console.error("[employee/daily-work-report] employee_activities add failed", {
        message: activityErr instanceof Error ? activityErr.message : String(activityErr),
        rid,
        companyId,
      });
    }

    try {
      await sendModuleNotification(db, {
        companyId,
        module: "attendance",
        eventKey: "newWorkReports",
        entityId: rid,
        title: `Nový denní výkaz ke schválení (${date})`,
        lines: [
          `Zaměstnanec: ${employeeName}`,
          jobName ? `Zakázka: ${jobName}` : "",
        ].filter(Boolean),
        actionPath: "/portal/labor/dochazka?tab=approvals",
      });
    } catch (emailErr) {
      console.warn("[employee/daily-work-report] email notify skipped", emailErr);
    }

    return NextResponse.json({ ok: true, id: rid });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[employee/daily-work-report] unhandled", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    return NextResponse.json(
      { error: err.message || "Uložení se nezdařilo." },
      { status: 500 }
    );
  }
}
