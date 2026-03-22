import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { verifyTerminalPinSessionToken } from "@/lib/terminal-session-jwt";

/**
 * Načtení zakázek podle ID pro veřejný terminál (JWT relace PIN).
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
  const raw = request.nextUrl.searchParams.get("ids") || "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ jobs: [] as { id: string; name: string }[] });
  }

  try {
    const jobsCol = db.collection("companies").doc(companyId).collection("jobs");
    const out: { id: string; name: string }[] = [];
    for (const id of ids.slice(0, 30)) {
      const snap = await jobsCol.doc(id).get();
      if (!snap.exists) continue;
      const data = snap.data() as { name?: string };
      out.push({
        id: snap.id,
        name: typeof data.name === "string" ? data.name.trim() || snap.id : snap.id,
      });
    }
    return NextResponse.json({ jobs: out });
  } catch (e) {
    console.error("[terminal/jobs]", e);
    return NextResponse.json({ error: "Zakázky se nepodařilo načíst." }, { status: 500 });
  }
}
