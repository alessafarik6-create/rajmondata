import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { kioskAuthUidForCompany } from "@/lib/terminal-kiosk";

const TOKEN_MIN = 32;
const TOKEN_MAX = 128;

function isLinkExpired(expiresAt: unknown): boolean {
  if (expiresAt == null) return false;
  if (expiresAt instanceof Timestamp) {
    return expiresAt.toMillis() <= Date.now();
  }
  const withDate = expiresAt as { toDate?: () => Date; toMillis?: () => number };
  if (typeof withDate.toMillis === "function") {
    return withDate.toMillis() <= Date.now();
  }
  if (typeof withDate.toDate === "function") {
    return withDate.toDate().getTime() <= Date.now();
  }
  if (typeof expiresAt === "string") {
    const ms = Date.parse(expiresAt);
    if (!Number.isNaN(ms)) return ms <= Date.now();
  }
  return true;
}

/**
 * Ověří token v `terminalLinks/{token}` a vrátí custom token pro kiosk (terminalAccess + companyId).
 */
export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json(
        { error: "SERVER_ERROR" },
        { status: 503 }
      );
    }

    let body: { token?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    const token =
      typeof body.token === "string" ? body.token.trim() : "";
    if (
      !token ||
      token.length < TOKEN_MIN ||
      token.length > TOKEN_MAX ||
      !/^[a-fA-F0-9]+$/.test(token)
    ) {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    console.log("[terminal-access/session] token:", token);

    const linkRef = db.collection("terminalLinks").doc(token);
    const snap = await linkRef.get();

    if (!snap.exists) {
      console.log("[terminal-access/session] document: not found");
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    const data = snap.data() as {
      companyId?: string;
      active?: boolean;
      expiresAt?: unknown;
    };
    console.log("[terminal-access/session] document:", {
      id: snap.id,
      companyId: data?.companyId,
      active: data?.active,
      hasExpiresAt: data?.expiresAt != null,
    });

    const companyId =
      typeof data.companyId === "string" ? data.companyId.trim() : "";
    if (!companyId || data.active !== true || isLinkExpired(data.expiresAt)) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 400 });
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

    await linkRef.set(
      { lastUsedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      companyId,
      customToken,
    });
  } catch (error) {
    console.error("Terminal session error:", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
