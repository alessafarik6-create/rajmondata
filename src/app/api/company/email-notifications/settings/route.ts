import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { mergeEmailNotifications } from "@/lib/email-notifications/schema";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }
  if (!callerCanManageOrgEmailSettings(caller)) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  let body: { companyId?: string; emailNotifications?: unknown };
  try {
    body = (await request.json()) as { companyId?: string; emailNotifications?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 400 });
  }

  if (body.emailNotifications == null || typeof body.emailNotifications !== "object") {
    return NextResponse.json({ ok: false, error: "Chybí objekt emailNotifications." }, { status: 400 });
  }

  const normalized = mergeEmailNotifications(body.emailNotifications);
  const toStore = JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>;
  const payload = {
    emailNotifications: toStore,
    updatedAt: FieldValue.serverTimestamp(),
  };

  try {
    await Promise.all([
      db.collection(COMPANIES_COLLECTION).doc(companyId).set(payload, { merge: true }),
      db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).set(payload, { merge: true }),
    ]);
  } catch (e) {
    console.error("[email-notifications/settings] Firestore write failed", companyId, e);
    const msg = e instanceof Error ? e.message : "Zápis do databáze se nezdařil.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
