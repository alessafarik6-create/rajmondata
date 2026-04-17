import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  validateEmployeeBankAccountInput,
  type EmployeeBankAccount,
} from "@/lib/employee-bank-account";

type Body = {
  bankAccount?: Partial<EmployeeBankAccount>;
};

/**
 * Zaměstnanec upravuje vlastní bankovní údaje — jen pokud to firma povolí
 * (`allowEmployeeBankAccountSelfEdit` na companies/{companyId}).
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

  const userSnap = await db.collection("users").doc(callerUid).get();
  const userData = userSnap.data() as Record<string, unknown> | undefined;
  if (!userData) {
    return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
  }

  const companyId = String(userData.companyId || "").trim();
  const employeeId = String(userData.employeeId || "").trim();
  if (!companyId || !employeeId) {
    return NextResponse.json(
      { error: "Účet není propojen se zaměstnancem organizace." },
      { status: 403 }
    );
  }

  const companySnap = await db.collection("companies").doc(companyId).get();
  const company = companySnap.data() as Record<string, unknown> | undefined;
  const settings =
    company?.settings && typeof company.settings === "object"
      ? (company.settings as Record<string, unknown>)
      : null;
  const allowed =
    company?.allowEmployeeBankAccountSelfEdit === true ||
    settings?.allowEmployeeBankAccountSelfEdit === true;
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Úprava vlastního účtu není v organizaci povolena. Kontaktujte administrátora.",
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
    return NextResponse.json({ error: "Záznam zaměstnance neexistuje." }, { status: 404 });
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
