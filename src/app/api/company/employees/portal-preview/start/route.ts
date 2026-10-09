import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  buildNewPortalPreviewSession,
  canStartPortalPreviewAsAdmin,
} from "@/lib/portal-preview";
import { writePortalPreviewAudit } from "@/lib/portal-preview-server";

type Body = { employeeId?: string; companyId?: string };

function employeeDisplayName(emp: Record<string, unknown>): string {
  const first = String(emp.firstName ?? "").trim();
  const last = String(emp.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || String(emp.email ?? "").trim() || "Zaměstnanec";
}

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
    callerUid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
  }

  const globalRoles = caller.globalRoles as string[] | undefined;
  const callerRole = String(caller.role || "");
  if (!canStartPortalPreviewAsAdmin(callerRole, globalRoles)) {
    return NextResponse.json(
      { error: "Náhled portálu smí spustit pouze administrátor organizace." },
      { status: 403 }
    );
  }

  const callerCompany = String(caller.companyId || caller.organizationId || "").trim();
  if (!callerCompany) {
    return NextResponse.json({ error: "Chybí organizace." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  const companyId = String(body.companyId || callerCompany).trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
  }
  if (companyId !== callerCompany) {
    return NextResponse.json({ error: "Nelze zobrazit zaměstnance jiné organizace." }, { status: 403 });
  }

  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Zaměstnanec neexistuje." }, { status: 404 });
  }
  const emp = empSnap.data() as Record<string, unknown>;
  if (String(emp.companyId || companyId) !== companyId) {
    return NextResponse.json({ error: "Neplatná firma zaměstnance." }, { status: 403 });
  }

  const session = buildNewPortalPreviewSession({
    employeeId,
    companyId,
    displayName: employeeDisplayName(emp),
  });

  await db.collection("users").doc(callerUid).set(
    {
      portalPreviewSession: {
        employeeId: session.employeeId,
        displayName: session.displayName,
        companyId: session.companyId,
        startedAtMs: session.startedAtMs,
        expiresAtMs: session.expiresAtMs,
        startedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writePortalPreviewAudit(db, {
    companyId,
    adminUid: callerUid,
    employeeId,
    displayName: session.displayName,
    action: "PORTAL_PREVIEW_STARTED",
  });

  return NextResponse.json({
    ok: true,
    session: {
      employeeId: session.employeeId,
      displayName: session.displayName,
      expiresAtMs: session.expiresAtMs,
    },
  });
}
