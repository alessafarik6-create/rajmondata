import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";

type Body = {
  companyId?: string;
  employeeId?: string;
  pin?: string;
};

/**
 * Zakázky přiřazené zaměstnanci pro docházku (po ověření PINu v těle požadavku).
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
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId || "").trim();
  const employeeId = String(body.employeeId || "").trim();
  const pin = normalizeTerminalPin(body.pin != null ? String(body.pin) : "");

  if (!companyId || !employeeId || !pin) {
    return NextResponse.json({ error: "Chybí companyId, employeeId nebo PIN." }, { status: 400 });
  }

  try {
    const ok = await verifyAttendancePinForEmployee(db, companyId, employeeId, pin);
    if (!ok) {
      return NextResponse.json({ error: "Neplatný PIN." }, { status: 401 });
    }

    const empSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    const data = empSnap.data() as Record<string, unknown> | undefined;
    const ids = Array.isArray(data?.assignedTerminalJobIds)
      ? (data!.assignedTerminalJobIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    if (ids.length === 0) {
      console.log("Jobs loaded", { count: 0 });
      return NextResponse.json({ jobs: [] as { id: string; name: string }[] });
    }

    const jobsCol = db.collection("companies").doc(companyId).collection("jobs");
    const out: { id: string; name: string }[] = [];
    for (const id of ids.slice(0, 40)) {
      const snap = await jobsCol.doc(id).get();
      if (!snap.exists) continue;
      const jd = snap.data() as { name?: string };
      out.push({
        id: snap.id,
        name: typeof jd.name === "string" ? jd.name.trim() || snap.id : snap.id,
      });
    }
    console.log("Jobs loaded", { count: out.length });
    return NextResponse.json({ jobs: out });
  } catch (e) {
    console.error("[attendance-login/jobs]", e);
    return NextResponse.json({ error: "Zakázky se nepodařilo načíst." }, { status: 500 });
  }
}
