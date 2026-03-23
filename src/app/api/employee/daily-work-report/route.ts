import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  estimateLaborFromJobSplits,
  resolveSegmentJobSplits,
} from "@/lib/daily-work-report-resolve";

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
  segmentJobSplits?: Array<{ segmentId?: string; jobId?: string; hours?: number }>;
  /** Volitelné poznámky k řádkům hlavního denního formuláře (odpovídají pořadí řádků u odemčených úseků). */
  dayWorkLines?: Array<{ lineNote?: string }>;
  /** `draft` = rozpracováno, `submit` = odeslat ke schválení */
  mode?: "draft" | "submit";
};

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

    const note = typeof body.note === "string" ? body.note.trim() : "";
    const dayWorkLines = Array.isArray(body.dayWorkLines)
      ? body.dayWorkLines.map((x) => ({
          lineNote:
            typeof (x as { lineNote?: string }).lineNote === "string"
              ? String((x as { lineNote?: string }).lineNote).trim()
              : "",
        }))
      : null;

    const rawSplits =
      Array.isArray(body.segmentJobSplits) && body.segmentJobSplits.length > 0
        ? body.segmentJobSplits
        : null;

    if (!rawSplits) {
      return NextResponse.json(
        {
          error:
            "Chybí rozdělení času (segmentJobSplits). Aktualizujte prosím stránku denního výkazu.",
        },
        { status: 400 }
      );
    }

    let resolved: Awaited<ReturnType<typeof resolveSegmentJobSplits>>;
    try {
      resolved = await resolveSegmentJobSplits(db, companyId, employeeId, date, emp, rawSplits, mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Neplatná data výkazu.";
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

    const estimatedLaborFromSegmentsCzk = await estimateLaborFromJobSplits(
      db,
      companyId,
      emp,
      segmentJobSplits
    );

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

    if (mode === "draft") {
      await ref.set(
        {
          ...payloadBase,
          status: "draft",
          updatedAt: FieldValue.serverTimestamp(),
          submittedAt: FieldValue.delete(),
        },
        { merge: true }
      );
      console.log("Daily work report draft saved");
      return NextResponse.json({ ok: true, id: rid });
    }

    await ref.set(
      {
        ...payloadBase,
        status: "pending",
        submittedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("Daily work report submitted");

    return NextResponse.json({ ok: true, id: rid });
  } catch (e) {
    console.error("[employee/daily-work-report]", e);
    return NextResponse.json({ error: "Uložení se nezdařilo." }, { status: 500 });
  }
}
