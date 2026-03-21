import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { kioskAuthUidForCompany } from "@/lib/terminal-kiosk";
import { getCompany } from "@/lib/superadmin-companies";
import { FieldValue } from "firebase-admin/firestore";

function getPublicOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return "";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id: companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ error: "ID chybí." }, { status: 400 });
  }

  try {
    const company = await getCompany(db, companyId);
    if (!company) {
      return NextResponse.json({ error: "Organizace nenalezena." }, { status: 404 });
    }

    const snap = await db
      .collection("terminalLinks")
      .where("companyId", "==", companyId)
      .where("active", "==", true)
      .limit(5)
      .get();

    const tokens = snap.docs.map((d) => ({
      token: d.id,
      active: (d.data() as { active?: boolean }).active === true,
      createdAt: (d.data() as { createdAt?: { toDate?: () => Date } }).createdAt?.toDate?.()?.toISOString() ?? null,
    }));

    const origin = getPublicOrigin(request);
    const active = tokens[0];
    const url = active && origin ? `${origin}/terminal/${active.token}` : active ? `/terminal/${active.token}` : null;

    return NextResponse.json({
      companyId,
      companyName: company.name,
      hasActiveToken: tokens.length > 0,
      activeToken: active?.token ?? null,
      url,
      tokens,
    });
  } catch (e) {
    console.error("[superadmin terminal GET]", e);
    return NextResponse.json({ error: "Načtení stavu terminálu se nezdařilo." }, { status: 500 });
  }
}

type TerminalAction = "generate" | "regenerate" | "deactivate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id: companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ error: "ID chybí." }, { status: 400 });
  }

  let body: { action?: TerminalAction };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  const action = body.action;
  if (!action || !["generate", "regenerate", "deactivate"].includes(action)) {
    return NextResponse.json({ error: "Neplatná akce." }, { status: 400 });
  }

  try {
    const company = await getCompany(db, companyId);
    if (!company) {
      return NextResponse.json({ error: "Organizace nenalezena." }, { status: 404 });
    }

    const kioskUid = kioskAuthUidForCompany(companyId);
    try {
      await auth.createUser({ uid: kioskUid, disabled: false });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/uid-already-exists") {
        throw e;
      }
    }
    await auth.setCustomUserClaims(kioskUid, {
      companyId,
      terminalAccess: true,
    });

    if (action === "deactivate") {
      const existing = await db
        .collection("terminalLinks")
        .where("companyId", "==", companyId)
        .where("active", "==", true)
        .get();
      const batch = db.batch();
      existing.docs.forEach((d) => {
        batch.update(d.ref, { active: false, deactivatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
      return NextResponse.json({ ok: true, url: null, token: null });
    }

    if (action === "generate") {
      const activeSnap = await db
        .collection("terminalLinks")
        .where("companyId", "==", companyId)
        .where("active", "==", true)
        .limit(1)
        .get();
      if (!activeSnap.empty) {
        const doc = activeSnap.docs[0];
        const token = doc.id;
        const origin = getPublicOrigin(request);
        const url = origin ? `${origin}/terminal/${token}` : `/terminal/${token}`;
        return NextResponse.json({
          ok: true,
          token,
          url,
          alreadyExists: true,
        });
      }
    }

    if (action === "regenerate") {
      const existing = await db.collection("terminalLinks").where("companyId", "==", companyId).get();
      const batch = db.batch();
      existing.docs.forEach((d) => {
        batch.update(d.ref, { active: false, rotatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }

    const newToken = randomBytes(32).toString("hex");
    await db.collection("terminalLinks").doc(newToken).set({
      companyId,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    const origin = getPublicOrigin(request);
    const url = origin ? `${origin}/terminal/${newToken}` : `/terminal/${newToken}`;

    return NextResponse.json({
      ok: true,
      token: newToken,
      url,
    });
  } catch (e) {
    console.error("[superadmin terminal POST]", e);
    return NextResponse.json({ error: "Operace se nezdařila." }, { status: 500 });
  }
}
