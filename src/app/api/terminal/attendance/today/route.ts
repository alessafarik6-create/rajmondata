import { NextRequest, NextResponse } from "next/server";
import type { Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyTerminalPinSessionToken } from "@/lib/terminal-session-jwt";

function millisFromFirestoreTimestamp(ts: unknown): number {
  if (ts && typeof ts === "object" && "toMillis" in ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

/**
 * Dnešní záznamy docházky pro zaměstnance — pouze s JWT relací PIN (bez Firebase Auth).
 */
export async function GET(request: NextRequest) {
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

  const companyId = payload.companyId;
  const employeeId = payload.employeeId;
  const today = new Date().toISOString().split("T")[0];

  try {
    const snap = await db
      .collection("companies")
      .doc(companyId)
      .collection("attendance")
      .where("employeeId", "==", employeeId)
      .where("date", "==", today)
      .get();

    const events = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const ts = data.timestamp;
        return {
          id: d.id,
          type: data.type,
          millis: millisFromFirestoreTimestamp(ts),
        };
      })
      .filter((e) => e.type != null && typeof e.type === "string");

    events.sort((a, b) => b.millis - a.millis);

    return NextResponse.json({ companyId, employeeId, date: today, events });
  } catch (e) {
    console.error("[terminal/attendance/today]", e);
    return NextResponse.json({ error: "Docházku se nepodařilo načíst." }, { status: 500 });
  }
}
