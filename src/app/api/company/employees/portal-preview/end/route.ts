import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  loadUserPortalPreviewSession,
  writePortalPreviewAudit,
} from "@/lib/portal-preview-server";

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

  const session = await loadUserPortalPreviewSession(db, callerUid);
  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  const companyId = String(caller?.companyId || caller?.organizationId || "").trim();

  await db.collection("users").doc(callerUid).set(
    {
      portalPreviewSession: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (session && companyId) {
    await writePortalPreviewAudit(db, {
      companyId,
      adminUid: callerUid,
      employeeId: session.employeeId,
      displayName: session.displayName,
      action: "PORTAL_PREVIEW_ENDED",
    });
  }

  return NextResponse.json({
    ok: true,
    returnEmployeeId: session?.employeeId ?? null,
  });
}
