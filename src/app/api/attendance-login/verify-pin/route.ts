import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
};

export async function POST(request: NextRequest) {
  console.log("PIN verifying");
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

  try {
    const ok = await verifyAttendancePinForEmployee(db, companyId, employeeId, pin);
    if (ok) {
      console.log("PIN success");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Neplatný PIN." }, { status: 401 });
  } catch (e) {
    console.error("[attendance-login/verify-pin]", e);
    return NextResponse.json({ error: "Ověření se nezdařilo." }, { status: 500 });
  }
}
