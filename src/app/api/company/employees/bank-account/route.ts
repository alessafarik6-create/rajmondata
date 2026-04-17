import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  validateEmployeeBankAccountInput,
  type EmployeeBankAccount,
} from "@/lib/employee-bank-account";

type Body = {
  employeeId?: string;
  bankAccount?: Partial<EmployeeBankAccount>;
};

const PRIV_ROLES = new Set(["owner", "admin", "manager", "accountant"]);

/**
 * Úprava bankovních údajů zaměstnance (výplata).
 * Oprávnění: vlastník, admin, manager, účetní organizace (shodně s isPrivileged ve Firestore).
 */
export async function PATCH(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!idToken) {
    return NextResponse.json(
      { error: "Chybí Authorization Bearer token." },
      { status: 401 }
    );
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
    return NextResponse.json(
      { error: "Profil volajícího neexistuje." },
      { status: 403 }
    );
  }

  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin =
    Array.isArray(globalRoles) && globalRoles.includes("super_admin");

  const companyId = String(caller.companyId || "").trim();
  const callerRole = String(caller.role || "");
  if (!companyId || (!PRIV_ROLES.has(callerRole) && !isSuperAdmin)) {
    return NextResponse.json(
      {
        error:
          "Bankovní údaje zaměstnance může upravit jen vedení organizace (vlastník, administrátor, manager, účetní).",
      },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
  }

  const raw = body.bankAccount ?? {};
  const validated = validateEmployeeBankAccountInput({
    accountNumber: String(raw.accountNumber ?? ""),
    bankCode: String(raw.bankCode ?? ""),
    iban: String(raw.iban ?? ""),
    bic: String(raw.bic ?? ""),
    paymentNote: String(raw.paymentNote ?? ""),
  });

  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const empRef = db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Zaměstnanec neexistuje." }, { status: 404 });
  }
  const emp = empSnap.data() as Record<string, unknown>;
  if (String(emp.companyId || "") !== companyId) {
    return NextResponse.json({ error: "Neplatná firma." }, { status: 403 });
  }

  const norm = validated.normalized;
  const hasData =
    norm.accountNumber ||
    norm.bankCode ||
    norm.iban ||
    norm.bic ||
    norm.paymentNote;

  await empRef.set(
    {
      bankAccount: hasData ? norm : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, bankAccount: hasData ? norm : null });
}
