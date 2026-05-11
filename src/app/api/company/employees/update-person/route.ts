import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

type Body = {
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  jobTitle?: string;
};

const PRIV_ROLES = new Set(["owner", "admin", "manager", "accountant"]);

const MAX_NAME = 80;
const MAX_EMAIL = 320;
const MAX_PHONE = 40;
const MAX_ADDR = 500;
const MAX_NOTE = 4000;
const MAX_TITLE = 200;

function trimLen(s: unknown, max: number): string {
  const t = String(s ?? "").trim();
  return t.slice(0, max);
}

/**
 * Osobní údaje zaměstnance (jméno, kontakt, poznámka) + synchronizace Firebase Auth displayName
 * a dokumentu users/{authUserId} pro chat, notifikace a profil portálu.
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
          "Údaje zaměstnance může upravit jen vedení organizace (vlastník, administrátor, manager, účetní).",
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

  const firstName = trimLen(body.firstName, MAX_NAME);
  const lastName = trimLen(body.lastName, MAX_NAME);
  const email = trimLen(body.email, MAX_EMAIL).toLowerCase();
  const phone = trimLen(body.phone, MAX_PHONE);
  const address = trimLen(body.address, MAX_ADDR);
  const note = trimLen(body.note, MAX_NOTE);
  const jobTitle = trimLen(body.jobTitle, MAX_TITLE);

  if (!firstName && !lastName) {
    return NextResponse.json(
      { error: "Vyplňte alespoň jméno nebo příjmení." },
      { status: 400 }
    );
  }
  if (!email) {
    return NextResponse.json({ error: "E-mail je povinný." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Neplatný formát e-mailu." }, { status: 400 });
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

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();

  await empRef.set(
    {
      firstName,
      lastName,
      email,
      phone,
      address,
      note,
      jobTitle,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const authUserId = String(emp.authUserId || "").trim();
  if (authUserId) {
    try {
      await auth.updateUser(authUserId, {
        ...(displayName ? { displayName } : {}),
      });
    } catch (e) {
      console.error("[update-person] auth.updateUser", e);
    }
    try {
      await db.collection("users").doc(authUserId).set(
        {
          displayName,
          firstName,
          lastName,
          email,
          jobTitle,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("[update-person] users merge", e);
    }
  }

  return NextResponse.json({ ok: true, displayName });
}
