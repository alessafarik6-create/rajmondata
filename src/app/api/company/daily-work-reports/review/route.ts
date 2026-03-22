import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

type Body = {
  companyId?: string;
  employeeId?: string;
  date?: string;
  action?: "approve" | "reject";
  adminNote?: string | null;
};

function reportDocId(employeeId: string, date: string) {
  return `${employeeId}__${date}`;
}

/**
 * Schválení / zamítnutí denního výkazu — owner / admin / manager / účetní.
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
  const employeeId = String(body.employeeId || "").trim();
  const date = String(body.date || "").trim();
  const action = body.action;

  if (!companyId || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Chybí platné údaje výkazu." }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Neplatná akce." }, { status: 400 });
  }

  try {
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const caller = callerSnap.data() as Record<string, unknown> | undefined;
    if (!caller) {
      return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
    }
    const callerCompany = String(caller.companyId || "").trim();
    const callerRole = String(caller.role || "");
    const globalRoles = caller.globalRoles as string[] | undefined;
    const isSuper = Array.isArray(globalRoles) && globalRoles.includes("super_admin");
    const privileged =
      isSuper || ["owner", "admin", "manager", "accountant"].includes(callerRole);

    if (!privileged || callerCompany !== companyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }

    const reviewerName =
      String(caller.displayName || "").trim() ||
      String(caller.email || "").trim() ||
      callerUid;

    const rid = reportDocId(employeeId, date);
    const ref = db
      .collection("companies")
      .doc(companyId)
      .collection("daily_work_reports")
      .doc(rid);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Výkaz neexistuje." }, { status: 404 });
    }

    const adminNote =
      typeof body.adminNote === "string" && body.adminNote.trim() ? body.adminNote.trim() : null;

    await ref.update({
      status: action === "approve" ? "approved" : "rejected",
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedByUid: callerUid,
      reviewedByName: reviewerName,
      adminNote: adminNote ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      action === "approve"
        ? "Daily work report approved by admin"
        : "Daily work report rejected by admin"
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[company/daily-work-reports/review]", e);
    return NextResponse.json({ error: "Aktualizace se nezdařila." }, { status: 500 });
  }
}
