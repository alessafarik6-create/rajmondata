import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * Veřejný seznam zaměstnanců pro /attendance-login (bez Auth).
 * Vyžaduje companyId v query — odkaz z portálu s ID firmy.
 */
export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 500 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId")?.trim() ?? "";
  if (!companyId) {
    return NextResponse.json({ error: "Chybí companyId." }, { status: 400 });
  }

  try {
    const snap = await db.collection("companies").doc(companyId).collection("employees").get();
    const employees = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.isActive === false) return null;
        const photoURL =
          typeof data.photoURL === "string" && data.photoURL.trim()
            ? data.photoURL.trim()
            : typeof data.avatarUrl === "string" && data.avatarUrl.trim()
              ? data.avatarUrl.trim()
              : null;
        return {
          id: d.id,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
          photoURL,
          isActive: data.isActive !== false,
        };
      })
      .filter(Boolean);
    return NextResponse.json({ companyId, employees });
  } catch (e) {
    console.error("[attendance-login/employees]", e);
    return NextResponse.json({ error: "Zaměstnance se nepodařilo načíst." }, { status: 500 });
  }
}
