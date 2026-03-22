import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveTerminalCompanyId } from "@/lib/terminal-company-resolve";

/**
 * Seznam zaměstnanců pro QR režim — server-side, bez klientského Auth.
 */
export async function GET() {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }
  try {
    const companyId = await resolveTerminalCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: "Firma nebyla nalezena." }, { status: 503 });
    }
    const snap = await db.collection("companies").doc(companyId).collection("employees").get();
    const employees = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.isActive === false) return null;
        return {
          id: d.id,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
          attendanceQrId: data.attendanceQrId != null ? String(data.attendanceQrId) : null,
          isActive: data.isActive !== false,
          assignedTerminalJobIds: Array.isArray(data.assignedTerminalJobIds)
            ? (data.assignedTerminalJobIds as unknown[]).filter((x): x is string => typeof x === "string")
            : [],
          jobTitle: typeof data.jobTitle === "string" ? data.jobTitle : undefined,
        };
      })
      .filter(Boolean);
    return NextResponse.json({ companyId, employees });
  } catch (e) {
    console.error("[terminal/employees]", e);
    return NextResponse.json({ error: "Zaměstnance se nepodařilo načíst." }, { status: 500 });
  }
}
