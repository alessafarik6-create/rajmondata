import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { passwordPolicyError } from "@/lib/employee-password-policy";

type Body = {
  customerId?: string;
  email?: string;
  password?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Vytvoří Firebase Auth účet (role customer) + users/{uid} a propojí zákazníka v CRM.
 * Volá pouze owner/admin (Bearer ID token).
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
      { error: "Pouze vlastník nebo administrátor firmy může zakládat klientské účty." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const customerId = String(body.customerId || "").trim();
  const password = String(body.password || "");
  const emailOverride = String(body.email || "").trim();

  if (!customerId) {
    return NextResponse.json({ error: "Chybí customerId." }, { status: 400 });
  }

  const pwdPolicy = passwordPolicyError(password);
  if (pwdPolicy) {
    return NextResponse.json({ error: pwdPolicy }, { status: 400 });
  }

  const customerRef = db
    .collection("companies")
    .doc(companyId)
    .collection("customers")
    .doc(customerId);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) {
    return NextResponse.json({ error: "Zákazník neexistuje." }, { status: 404 });
  }

  const c = customerSnap.data() as Record<string, unknown>;
  const existingPortalUid =
    typeof c.customerPortalUid === "string" && c.customerPortalUid.trim()
      ? c.customerPortalUid.trim()
      : "";
  if (existingPortalUid) {
    return NextResponse.json(
      {
        error:
          "Pro tohoto zákazníka už existuje přihlašovací účet. Použijte reset hesla nebo deaktivaci přístupu.",
      },
      { status: 409 }
    );
  }

  const email = normalizeEmail(emailOverride || String(c.email || ""));
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      {
        error:
          "Zadejte platný e-mail (v profilu zákazníka nebo ve formuláři). Bez e-mailu nelze vytvořit přihlášení.",
      },
      { status: 400 }
    );
  }

  try {
    await auth.getUserByEmail(email);
    return NextResponse.json(
      { error: "Uživatel s tímto e-mailem již v systému existuje." },
      { status: 409 }
    );
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[create-portal-auth] getUserByEmail", e);
      return NextResponse.json({ error: "Chyba ověření emailu." }, { status: 500 });
    }
  }

  const firstName = String(c.firstName || "").trim() || "Zákazník";
  const lastName = String(c.lastName || "").trim() || "";
  const displayName =
    `${firstName} ${lastName}`.trim() ||
    String(c.companyName || "").trim() ||
    "Zákazník";

  let newUid: string;
  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
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
    console.error("[create-portal-auth] createUser", e);
    return NextResponse.json(
      { error: "Nepodařilo se vytvořit přihlašovací účet." },
      { status: 500 }
    );
  }

  const jobsSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .where("customerId", "==", customerId)
    .get();
  const linkedJobIds = jobsSnap.docs.map((d) => d.id);

  const batch = db.batch();

  batch.set(db.collection("users").doc(newUid), {
    id: newUid,
    email,
    displayName,
    firstName,
    lastName,
    role: "customer",
    companyId,
    customerRecordId: customerId,
    linkedJobIds,
    globalRoles: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.update(customerRef, {
    customerPortalEnabled: true,
    customerPortalUid: newUid,
    customerPortalEmail: email,
    customerPortalCreatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (e) {
    console.error("[create-portal-auth] batch", e);
    try {
      await auth.deleteUser(newUid);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      { error: "Nepodařilo se uložit profil zákazníka portálu." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    uid: newUid,
    email,
    linkedJobCount: linkedJobIds.length,
    message:
      "Klientský účet byl vytvořen. Zákazník se přihlásí na stejné přihlašovací stránce jako firma; bude přesměrován do klientského portálu.",
  });
}
