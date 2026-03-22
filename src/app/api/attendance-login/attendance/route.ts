import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";

type Action = "check-in" | "check-out";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
  action?: Action;
  jobId?: string | null;
  jobName?: string | null;
  employeeName?: string;
};

function mapAction(a: Action): "check_in" | "check_out" {
  return a === "check-in" ? "check_in" : "check_out";
}

/**
 * Zápis docházky z veřejné přihlašovací stránky — PIN v každém požadavku, bez JWT.
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

    const type = mapAction(actionRaw);
    const date = new Date().toISOString().split("T")[0];

    const docPayload: Record<string, unknown> = {
      employeeId,
      employeeName,
      type,
      timestamp: FieldValue.serverTimestamp(),
      date,
      source: "attendance-login",
    };

    if (body.jobId) {
      docPayload.jobId = body.jobId;
      docPayload.jobName = typeof body.jobName === "string" ? body.jobName : "";
    }

    await db.collection("companies").doc(companyId).collection("attendance").add(docPayload);

    if (type === "check_in") console.log("Check-in saved");
    else console.log("Check-out saved");

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[attendance-login/attendance]", e);
    return NextResponse.json({ error: "Zápis docházky se nezdařil." }, { status: 500 });
  }
}
