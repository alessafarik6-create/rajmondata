import { NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { kioskAuthUidForCompany } from "@/lib/terminal-kiosk";

/**
 * Veřejný bootstrap terminálu na `/terminal` — bez tokenu v URL.
 * Firma: `TERMINAL_COMPANY_ID` (env), jinak první dokument v `companies` (řazení podle ID).
 */
async function resolveTerminalCompanyId(): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const envId = process.env.TERMINAL_COMPANY_ID?.trim();
  if (envId) {
    const snap = await db.collection("companies").doc(envId).get();
    if (snap.exists) return envId;
    console.error("[terminal/session] TERMINAL_COMPANY_ID neexistuje ve Firestore:", envId);
    return null;
  }

  const q = await db.collection("companies").orderBy(FieldPath.documentId()).limit(1).get();
  if (q.empty) {
    console.error("[terminal/session] Ve Firestore není žádná firma.");
    return null;
  }
  return q.docs[0].id;
}

export async function POST() {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Server nemá nakonfigurovaný Firebase Admin." },
      { status: 503 }
    );
  }

  try {
    const companyId = await resolveTerminalCompanyId();
    if (!companyId) {
      return NextResponse.json(
        {
          error:
            "Terminál není nakonfigurován. Nastavte TERMINAL_COMPANY_ID nebo přidejte firmu do databáze.",
        },
        { status: 503 }
      );
    }

    const uid = kioskAuthUidForCompany(companyId);
    try {
      await auth.createUser({ uid, disabled: false });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/uid-already-exists") {
        throw e;
      }
    }

    await auth.setCustomUserClaims(uid, {
      companyId,
      terminalAccess: true,
    });

    const customToken = await auth.createCustomToken(uid, {
      companyId,
      terminalAccess: true,
    });

    return NextResponse.json({
      customToken,
      companyId,
    });
  } catch (e) {
    console.error("[terminal/session]", e);
    return NextResponse.json({ error: "Přihlášení terminálu se nezdařilo." }, { status: 500 });
  }
}
