import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const PRIVILEGED_ROLES = ["owner", "admin", "manager", "accountant"];

type Body = {
  /** Pro super_admin: cílová firma. */
  companyId?: string;
};

/**
 * Vytvoří nový token v `terminalLinks/{token}` a synchronizuje `companies/{id}/settings/terminal`.
 * Pouze privilegované role stejné firmy (nebo super_admin).
 */
export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
    }

    let callerUid: string;
    try {
      const decoded = await auth.verifyIdToken(idToken);
      callerUid = decoded.uid;
    } catch {
      return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
    }

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      body = {};
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
      if (!PRIVILEGED_ROLES.includes(callerRole)) {
        return NextResponse.json(
          { error: "Nemáte oprávnění spravovat odkaz terminálu." },
          { status: 403 }
        );
      }
      if (callerCompanyId !== targetCompanyId) {
        return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
      }
    }

    const newToken = randomBytes(32).toString("hex");
    const expiresAt = Timestamp.fromMillis(Date.now() + THIRTY_DAYS_MS);
    const now = FieldValue.serverTimestamp();

    const existing = await db
      .collection("terminalLinks")
      .where("companyId", "==", targetCompanyId)
      .get();

    const batch = db.batch();
    existing.docs.forEach((d) => {
      batch.update(d.ref, { active: false, rotatedAt: now });
    });

    const linkRef = db.collection("terminalLinks").doc(newToken);
    batch.set(linkRef, {
      companyId: targetCompanyId,
      active: true,
      createdAt: now,
      expiresAt,
    });

    const settingsRef = db.doc(`companies/${targetCompanyId}/settings/terminal`);
    batch.set(
      settingsRef,
      {
        token: newToken,
        updatedAt: now,
      },
      { merge: true }
    );

    await batch.commit();

    const savedSnap = await linkRef.get();
    console.log("[terminal-access-link] created token:", newToken);
    console.log("[terminal-access-link] saved document:", {
      path: linkRef.path,
      exists: savedSnap.exists,
      data: savedSnap.exists ? savedSnap.data() : null,
    });

    return NextResponse.json({
      success: true,
      token: newToken,
      path: `/terminal-access/${newToken}`,
    });
  } catch (error) {
    console.error("[terminal-access-link]", error);
    return NextResponse.json(
      { error: "Uložení odkazu se nezdařilo." },
      { status: 500 }
    );
  }
}
