import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  TERMINAL_LINKS_COLLECTION,
  TERMINAL_LINK_ACTIVE_FIELD,
  TERMINAL_LINK_COMPANY_ID_FIELD,
} from "@/lib/firestore-collections";

type Body = {
  companyId?: string;
};

/**
 * Propojí veřejný terminál se firmou: zápis do terminálOdkazy (kanonicky) + config/terminal (zpětná kompatibilita).
 * Pozn.: TERMINAL_COMPANY_ID v prostředí má při resolve stále přednost před Firestore — musí odpovídat.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
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
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const callerCompanyId = caller.companyId as string | undefined;
  const callerRole = (caller.role as string | undefined) || "";
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin = Array.isArray(globalRoles) && globalRoles.includes("super_admin");

  const fromBody = String(body.companyId || "").trim();
  let targetCompanyId = callerCompanyId || "";
  if (isSuperAdmin) {
    if (fromBody) targetCompanyId = fromBody;
  } else {
    targetCompanyId = callerCompanyId || "";
  }

  if (!targetCompanyId) {
    return NextResponse.json(
      { error: "Chybí identifikace organizace." },
      { status: 400 }
    );
  }

  if (!isSuperAdmin) {
    if (!["owner", "admin"].includes(callerRole)) {
      return NextResponse.json(
        { error: "Pouze vlastník nebo administrátor může propojit terminál s firmou." },
        { status: 403 }
      );
    }
    if (callerCompanyId !== targetCompanyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }
  }

  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(targetCompanyId).get();
  const compSnap = await db.collection(COMPANIES_COLLECTION).doc(targetCompanyId).get();
  if (!orgSnap.exists && !compSnap.exists) {
    return NextResponse.json({ error: "Firma neexistuje ve společnosti ani v companies." }, { status: 404 });
  }

  try {
    const linkRef = db.collection(TERMINAL_LINKS_COLLECTION).doc("default");
    await linkRef.set(
      {
        [TERMINAL_LINK_ACTIVE_FIELD]: true,
        [TERMINAL_LINK_COMPANY_ID_FIELD]: targetCompanyId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      },
      { merge: true }
    );
    await db.collection("config").doc("terminal").set(
      {
        companyId: targetCompanyId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      },
      { merge: true }
    );
    console.log("[terminal-config] Terminal company binding saved (terminálOdkazy + config/terminal)", {
      companyId: targetCompanyId,
    });
    return NextResponse.json({ ok: true, companyId: targetCompanyId });
  } catch (e) {
    console.error("[terminal-config]", e);
    return NextResponse.json({ error: "Uložení konfigurace se nezdařilo." }, { status: 500 });
  }
}
