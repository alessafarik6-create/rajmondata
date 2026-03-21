import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const TOKEN_MIN = 32;
const TOKEN_MAX = 128;

/**
 * Ověří odkaz terminálu a vrátí companyId — bez vytváření kiosk účtu.
 * Zaměstnanec se pak přihlásí běžným e-mailem/heslem v UI terminálu.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
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
    return NextResponse.json({ error: "Neplatný odkaz terminálu." }, { status: 400 });
  }

  try {
    const linkRef = db.collection("terminalLinks").doc(token);
    const snap = await linkRef.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Odkaz neexistuje nebo byl zrušen." },
        { status: 404 }
      );
    }
    const data = snap.data() as { companyId?: string; active?: boolean };
    const companyId = typeof data.companyId === "string" ? data.companyId.trim() : "";
    if (!companyId || data.active !== true) {
      return NextResponse.json({ error: "Terminál není aktivní." }, { status: 403 });
    }

    await linkRef.set(
      {
        lastUsedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ companyId });
  } catch (e) {
    console.error("[terminal/resolve]", e);
    return NextResponse.json({ error: "Ověření odkazu se nezdařilo." }, { status: 500 });
  }
}
