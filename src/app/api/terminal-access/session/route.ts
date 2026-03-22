import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { kioskAuthUidForCompany } from "@/lib/terminal-kiosk";
import { FieldValue } from "firebase-admin/firestore";

const TOKEN_MIN = 32;
const TOKEN_MAX = 128;

/**
 * Ověří token v companies/{companyId}/settings/terminal a vrátí custom token
 * (terminalAccess + companyId) pro kiosk účet firmy.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Server nemá nakonfigurovaný Firebase Admin." },
      { status: 503 }
    );
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (
    !token ||
    token.length < TOKEN_MIN ||
    token.length > TOKEN_MAX ||
    !/^[a-fA-F0-9]+$/.test(token)
  ) {
    return NextResponse.json(
      { error: "Neplatný terminálový odkaz" },
      { status: 400 }
    );
  }

  try {
    const snap = await db
      .collectionGroup("settings")
      .where("token", "==", token)
      .limit(10)
      .get();

    let companyId: string | null = null;
    for (const d of snap.docs) {
      if (d.id !== "terminal") continue;
      const parts = d.ref.path.split("/");
      if (
        parts.length === 4 &&
        parts[0] === "companies" &&
        parts[2] === "settings" &&
        parts[3] === "terminal"
      ) {
        companyId = parts[1];
        break;
      }
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "Neplatný terminálový odkaz" },
        { status: 404 }
      );
    }

    const terminalRef = db.doc(`companies/${companyId}/settings/terminal`);
    const terminalSnap = await terminalRef.get();
    const stored =
      terminalSnap.exists && (terminalSnap.data() as { token?: string })?.token;
    if (stored !== token) {
      return NextResponse.json(
        { error: "Neplatný terminálový odkaz" },
        { status: 404 }
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

    await terminalRef.set(
      { lastUsedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return NextResponse.json({ customToken, companyId });
  } catch (e) {
    console.error("[terminal-access/session]", e);
    return NextResponse.json(
      { error: "Přihlášení terminálu se nezdařilo." },
      { status: 500 }
    );
  }
}
