import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeUnreadPhotoNoteIntervalHours } from "@/lib/job-photo-comment-email-settings";

const PRIV_ROLES = new Set(["owner", "admin", "manager", "accountant"]);

type PatchBody = {
  employeeId?: string;
  emailMessageNotificationsEnabled?: boolean;
  emailUnreadPhotoNoteNotificationsEnabled?: boolean;
  unreadNoteNotificationIntervalHours?: unknown;
};

async function assertPrivilegedCaller() {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return {
      error: NextResponse.json(
        { error: "Firebase Admin není nakonfigurován." },
        { status: 503 }
      ),
    } as const;
  }
  return { db, auth } as const;
}

export async function GET(request: NextRequest) {
  const kit = await assertPrivilegedCaller();
  if ("error" in kit) return kit.error;
  const { db, auth } = kit;

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
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin = Array.isArray(globalRoles) && globalRoles.includes("super_admin");
  const companyId = String(caller.companyId || "").trim();
  const callerRole = String(caller.role || "");
  if (!companyId || (!PRIV_ROLES.has(callerRole) && !isSuperAdmin)) {
    return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
  }

  const employeeId = String(request.nextUrl.searchParams.get("employeeId") || "").trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
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
  if (String(emp.companyId || "") !== companyId) {
    return NextResponse.json({ error: "Neplatná firma." }, { status: 403 });
  }

  const authUserId = String(emp.authUserId || "").trim();
  if (!authUserId) {
    return NextResponse.json({
      ok: true,
      linked: false,
      emailMessageNotificationsEnabled: true,
      emailUnreadPhotoNoteNotificationsEnabled: true,
      unreadNoteNotificationIntervalHours: 24,
    });
  }

  const uSnap = await db.collection("users").doc(authUserId).get();
  const u = uSnap.data() as Record<string, unknown> | undefined;
  return NextResponse.json({
    ok: true,
    linked: true,
    authUserId,
    emailMessageNotificationsEnabled: u?.emailMessageNotificationsEnabled !== false,
    emailUnreadPhotoNoteNotificationsEnabled: u?.emailUnreadPhotoNoteNotificationsEnabled !== false,
    unreadNoteNotificationIntervalHours: normalizeUnreadPhotoNoteIntervalHours(
      u?.unreadNoteNotificationIntervalHours
    ),
  });
}

export async function PATCH(request: NextRequest) {
  const kit = await assertPrivilegedCaller();
  if ("error" in kit) return kit.error;
  const { db, auth } = kit;

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
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin = Array.isArray(globalRoles) && globalRoles.includes("super_admin");
  const companyId = String(caller.companyId || "").trim();
  const callerRole = String(caller.role || "");
  if (!companyId || (!PRIV_ROLES.has(callerRole) && !isSuperAdmin)) {
    return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
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
  if (String(emp.companyId || "") !== companyId) {
    return NextResponse.json({ error: "Neplatná firma." }, { status: 403 });
  }

  const authUserId = String(emp.authUserId || "").trim();
  if (!authUserId) {
    return NextResponse.json(
      { error: "Zaměstnanec nemá propojený účet portálu — nastavení nelze uložit." },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof body.emailMessageNotificationsEnabled === "boolean") {
    patch.emailMessageNotificationsEnabled = body.emailMessageNotificationsEnabled;
  }
  if (typeof body.emailUnreadPhotoNoteNotificationsEnabled === "boolean") {
    patch.emailUnreadPhotoNoteNotificationsEnabled = body.emailUnreadPhotoNoteNotificationsEnabled;
  }
  if (body.unreadNoteNotificationIntervalHours !== undefined) {
    patch.unreadNoteNotificationIntervalHours = normalizeUnreadPhotoNoteIntervalHours(
      body.unreadNoteNotificationIntervalHours
    );
  }

  await db.collection("users").doc(authUserId).set(patch, { merge: true });

  return NextResponse.json({ ok: true });
}
