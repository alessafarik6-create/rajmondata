import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { passwordPolicyError } from "@/lib/employee-password-policy";
import { userPortalRoleForEmployeeDocRole, type EmployeeOrgRole } from "@/lib/employee-organization";

type Body = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  jobTitle?: string;
  hourlyRate?: number | null;
  /** Role v organizaci: employee | orgAdmin */
  role?: string;
  visibleInAttendanceTerminal?: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Vytvoří Firebase Auth uživatele + users/{uid} + companies/{cid}/employees/{id}.
 * Volá pouze přihlášený owner/admin (ověření přes ID token).
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      {
        error:
          "Firebase Admin není nakonfigurován (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).",
      },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
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

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const companyId = caller.companyId as string | undefined;
  const callerRole = caller.role as string | undefined;
  if (!companyId || !["owner", "admin"].includes(callerRole || "")) {
    return NextResponse.json(
      { error: "Pouze vlastník nebo administrátor firmy může vytvářet účty zaměstnanců." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const email = normalizeEmail(String(body.email || ""));
  const password = String(body.password || "");
  const jobTitle = String(body.jobTitle || "").trim();
  const hourlyRate =
    body.hourlyRate != null && !Number.isNaN(Number(body.hourlyRate))
      ? Number(body.hourlyRate)
      : null;

  const rawOrgRole = String(body.role || "employee").trim();
  const orgRole: EmployeeOrgRole =
    rawOrgRole === "orgAdmin" ? "orgAdmin" : "employee";
  const visibleInAttendanceTerminal = body.visibleInAttendanceTerminal !== false;

  if (!firstName || !lastName || !email || !password) {
    return NextResponse.json(
      { error: "Jméno, příjmení, email a heslo jsou povinné." },
      { status: 400 }
    );
  }

  const pwdPolicy = passwordPolicyError(password);
  if (pwdPolicy) {
    return NextResponse.json({ error: pwdPolicy }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Neplatný formát emailu." }, { status: 400 });
  }

  try {
    await auth.getUserByEmail(email);
    return NextResponse.json(
      { error: "Uživatel s tímto emailem již v systému existuje." },
      { status: 409 }
    );
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[create-auth] getUserByEmail", e);
      return NextResponse.json({ error: "Chyba ověření emailu." }, { status: 500 });
    }
  }

  let newUid: string;
  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`.trim(),
    });
    newUid = userRecord.uid;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "auth/email-already-exists") {
      return NextResponse.json(
        { error: "Email je již registrován." },
        { status: 409 }
      );
    }
    if (code === "auth/weak-password") {
      return NextResponse.json(
        { error: "Heslo je příliš slabé. Zvolte delší nebo složitější heslo." },
        { status: 400 }
      );
    }
    if (code === "auth/invalid-email") {
      return NextResponse.json({ error: "Neplatný formát emailu." }, { status: 400 });
    }
    console.error("[create-auth] createUser", e);
    return NextResponse.json(
      { error: "Nepodařilo se vytvořit přihlašovací účet." },
      { status: 500 }
    );
  }

  const employeeRef = db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc();
  const employeeId = employeeRef.id;
  const attendanceQrId = `QR-${Math.random().toString(36).substring(2, 15)}`;

  const batch = db.batch();

  const portalRole = userPortalRoleForEmployeeDocRole(orgRole);

  batch.set(employeeRef, {
    firstName,
    lastName,
    email,
    role: orgRole,
    jobTitle,
    hourlyRate,
    companyId,
    organizationId: companyId,
    employeeId,
    authUserId: newUid,
    profileImage: null,
    isActive: true,
    visibleInAttendanceTerminal,
    /** Výchozí zapnuto; admin může vypnout v dialogu „Zakázky pro výkaz práce“. */
    enableDailyWorkLog: true,
    enableWorkLog: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    hireDate: new Date().toISOString().split("T")[0],
    attendanceQrId,
  });

  batch.set(db.collection("users").doc(newUid), {
    id: newUid,
    email,
    displayName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    role: portalRole,
    companyId,
    employeeId,
    jobTitle,
    hourlyRate,
    profileImage: null,
    globalRoles: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (e) {
    console.error("[create-auth] batch", e);
    try {
      await auth.deleteUser(newUid);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      { error: "Nepodařilo se uložit profil zaměstnance." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    uid: newUid,
    employeeId,
    message:
      "Účet vytvořen. Zaměstnanec se může přihlásit emailem a heslem; bude přesměrován do zaměstnaneckého portálu.",
  });
}
