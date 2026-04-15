import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
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

/**
 * Nahradí celé pole `emailNotifications` jedním objektem: `update()` přepíše mapu atomicky,
 * zatímco `set(..., { merge: true })` u vnořených map může nechat staré klíče s opačnými booleany.
 */
async function writeEmailNotificationsField(
  db: Firestore,
  collectionName: string,
  companyId: string,
  emailNotifications: Record<string, unknown>
): Promise<void> {
  const ref = db.collection(collectionName).doc(companyId);
  const snap = await ref.get();
  const payload = {
    emailNotifications,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    await ref.set(payload, { merge: true });
  } else {
    await ref.update(payload);
  }
}

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
  const mods = toStore.modules as Record<string, unknown> | undefined;
  const documents = mods?.documents as Record<string, unknown> | undefined;
  console.log("[email-notifications/settings] payload sample (documents module)", {
    companyId,
    newDocument: documents?.newDocument,
    pendingAssignment: documents?.pendingAssignment,
    updated: documents?.updated,
    approvedOrProcessed: documents?.approvedOrProcessed,
    enabled: documents?.enabled,
  });

  try {
    await Promise.all([
      writeEmailNotificationsField(db, COMPANIES_COLLECTION, companyId, toStore),
      writeEmailNotificationsField(db, ORGANIZATIONS_COLLECTION, companyId, toStore),
    ]);
  } catch (e) {
    console.error("[email-notifications/settings] Firestore write failed", companyId, e);
    const msg = e instanceof Error ? e.message : "Zápis do databáze se nezdařil.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  console.log("[email-notifications/settings] OK", {
    companyId,
    paths: [`${COMPANIES_COLLECTION}/${companyId}`, `${ORGANIZATIONS_COLLECTION}/${companyId}`],
  });
  return NextResponse.json({ ok: true });
}
