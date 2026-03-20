import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { passwordPolicyError } from "@/lib/employee-password-policy";
import { sendAdminPasswordResetNotification } from "@/lib/employee-password-email";

type Body = {
  employeeId?: string;
  newPassword?: string;
  /** Volitelné: super_admin může cílit jinou firmu než je v jeho profilu. */
  companyId?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Nastaví nové heslo existujícímu Firebase Auth uživateli zaměstnance (Admin SDK).
 * Volá owner / admin stejné firmy nebo super_admin s platným companyId.
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

  const callerCompanyId = caller.companyId as string | undefined;
  const callerRole = (caller.role as string | undefined) || "";
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin =
    Array.isArray(globalRoles) && globalRoles.includes("super_admin");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  const newPassword = String(body.newPassword || "");

  if (!employeeId) {
    return NextResponse.json({ error: "Chybí ID zaměstnance." }, { status: 400 });
  }

  const pwdErr = passwordPolicyError(newPassword);
  if (pwdErr) {
    return NextResponse.json({ error: pwdErr }, { status: 400 });
  }

  // Owner/admin vždy cílí jen vlastní firmu (companyId z těla se ignoruje kvůli bezpečnosti).
  let targetCompanyId = callerCompanyId;
  if (isSuperAdmin) {
    const fromBody = String(body.companyId || "").trim();
    if (fromBody) targetCompanyId = fromBody;
  }

  if (!targetCompanyId) {
    return NextResponse.json(
      {
        error:
          "Chybí identifikace organizace. U super administrátora zadejte companyId v těle požadavku.",
      },
      { status: 400 }
    );
  }

  if (!isSuperAdmin) {
    if (!["owner", "admin"].includes(callerRole)) {
      return NextResponse.json(
        { error: "Pouze vlastník nebo administrátor může resetovat heslo zaměstnance." },
        { status: 403 }
      );
    }
    if (callerCompanyId !== targetCompanyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }
  }

  const empRef = db
    .collection("companies")
    .doc(targetCompanyId)
    .collection("employees")
    .doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json(
      { error: "Zaměstnanec v této organizaci neexistuje." },
      { status: 404 }
    );
  }

  const emp = empSnap.data() as Record<string, unknown>;
  const authUserId = emp.authUserId as string | undefined;
  if (!authUserId || typeof authUserId !== "string") {
    return NextResponse.json(
      {
        error:
          "Tento zaměstnanec nemá propojený přihlašovací účet. Heslo lze nastavit jen u účtů vytvořených přes pozvánku s heslem.",
      },
      { status: 400 }
    );
  }

  try {
    await auth.updateUser(authUserId, { password: newPassword });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    console.error("[reset-password] updateUser", e);
    if (code === "auth/user-not-found") {
      return NextResponse.json(
        { error: "Přihlašovací účet zaměstnance v Auth neexistuje." },
        { status: 404 }
      );
    }
    if (code === "auth/weak-password") {
      return NextResponse.json(
        { error: "Heslo je příliš slabé. Zvolte delší nebo složitější heslo." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Nepodařilo se nastavit nové heslo. Zkuste to znovu." },
      { status: 500 }
    );
  }

  const emailRaw = emp.email != null ? String(emp.email) : "";
  const toEmail = emailRaw ? normalizeEmail(emailRaw) : "";
  const employeeDisplayName =
    [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim() || toEmail || "zaměstnanec";

  void sendAdminPasswordResetNotification({
    toEmail: toEmail || "unknown@local",
    employeeDisplayName,
    companyName: (caller.companyName as string) || null,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    message:
      "Nové heslo bylo nastaveno. Zaměstnanec se přihlásí novým heslem; staré heslo již neplatí.",
  });
}
