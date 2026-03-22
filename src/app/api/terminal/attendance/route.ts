import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyTerminalPinSessionToken } from "@/lib/terminal-session-jwt";

type AttendanceType = "check_in" | "break_start" | "break_end" | "check_out";

type Body = {
  type?: AttendanceType;
  jobId?: string | null;
  jobName?: string | null;
  employeeName?: string;
};

/**
 * Zápis docházky z veřejného terminálu po ověření PINu (JWT relace, ne Firebase Auth).
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Chybí relace terminálu (PIN)." }, { status: 401 });
  }

  const payload = await verifyTerminalPinSessionToken(token);
  if (!payload?.companyId || !payload?.employeeId) {
    return NextResponse.json({ error: "Neplatná relace terminálu." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const type = body.type;
  if (!type || !["check_in", "break_start", "break_end", "check_out"].includes(type)) {
    return NextResponse.json({ error: "Neplatný typ akce." }, { status: 400 });
  }

  const companyId = payload.companyId;
  const employeeId = payload.employeeId;
  const employeeName =
    typeof body.employeeName === "string" && body.employeeName.trim()
      ? body.employeeName.trim()
      : "";

  const date = new Date().toISOString().split("T")[0];

  const docPayload: Record<string, unknown> = {
    employeeId,
    employeeName,
    type,
    timestamp: FieldValue.serverTimestamp(),
    date,
    terminalId: "public-pin-terminal-api",
  };

  if (type === "check_in" && body.jobId) {
    docPayload.jobId = body.jobId;
    docPayload.jobName = typeof body.jobName === "string" ? body.jobName : "";
  }

  try {
    await db.collection("companies").doc(companyId).collection("attendance").add(docPayload);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[terminal/attendance]", e);
    return NextResponse.json({ error: "Zápis docházky se nezdařil." }, { status: 500 });
  }
}
