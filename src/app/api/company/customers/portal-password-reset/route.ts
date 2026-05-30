import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import {
  generateAppPasswordResetLink,
  resolveAppBaseUrl,
} from "@/lib/password-reset-link";

type Body = {
  customerId?: string;
};

/**
 * Vygeneruje odkaz na reset hesla (vlastní stránka portálu). Owner/admin zkopíruje odkaz zákazníkovi.
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
    return NextResponse.json({ error: "Nemáte oprávnění." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const customerId = String(body.customerId || "").trim();
  if (!customerId) {
    return NextResponse.json({ error: "Chybí customerId." }, { status: 400 });
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
  const portalEmail =
    typeof c.customerPortalEmail === "string" && c.customerPortalEmail.trim()
      ? c.customerPortalEmail.trim().toLowerCase()
      : typeof c.email === "string" && c.email.trim()
        ? c.email.trim().toLowerCase()
        : "";

  if (!portalEmail) {
    return NextResponse.json(
      { error: "U zákazníka chybí e-mail pro reset hesla." },
      { status: 400 }
    );
  }

  const portalUid =
    typeof c.customerPortalUid === "string" && c.customerPortalUid.trim()
      ? c.customerPortalUid.trim()
      : "";
  if (!portalUid) {
    return NextResponse.json(
      { error: "Klientský účet ještě nebyl vytvořen." },
      { status: 400 }
    );
  }

  const appBase = resolveAppBaseUrl();
  if (!appBase) {
    return NextResponse.json(
      {
        error:
          "Chybí APP_URL v konfiguraci serveru — nelze sestavit odkaz na portál (nastavte APP_URL=https://rajmondata.cz).",
      },
      { status: 503 }
    );
  }

  try {
    const resetLink = await generateAppPasswordResetLink(auth, portalEmail, appBase);
    return NextResponse.json({
      ok: true,
      resetLink,
      message:
        "Odkaz vede na stránku portálu pro nastavení hesla. Zkopírujte ho a bezpečně předejte zákazníkovi — platnost je omezená.",
    });
  } catch (e) {
    console.error("[portal-password-reset] generatePasswordResetLink", e);
    return NextResponse.json(
      { error: "Nepodařilo se vygenerovat odkaz pro obnovení hesla." },
      { status: 500 }
    );
  }
}
