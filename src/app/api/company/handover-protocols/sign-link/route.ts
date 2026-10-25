import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { assertCallerCanHandoverProtocolStaff } from "@/lib/handover-protocol-api-auth";
import {
  generateHandoverPublicSignToken,
  HANDOVER_PUBLIC_SIGN_TOKENS,
  HANDOVER_SIGN_LINK_TTL_MS,
  handoverPublicSignUrl,
} from "@/lib/handover-protocol-public-sign";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
    }

    const body = (await request.json()) as { companyId?: string; protocolId?: string; origin?: string };
    const companyId = String(body.companyId ?? "").trim();
    const protocolId = String(body.protocolId ?? "").trim();
    if (!companyId || !protocolId) {
      return NextResponse.json({ ok: false, error: "Chybí údaje." }, { status: 400 });
    }

    const pref = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("handoverProtocols")
      .doc(protocolId);
    const snap = await pref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Protokol neexistuje." }, { status: 404 });
    }
    const rec = snap.data() ?? {};
    const jobId = String(rec.jobId ?? "").trim();
    const gate = await assertCallerCanHandoverProtocolStaff(db, caller, companyId, jobId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    if (rec.status === "signed_by_customer" || rec.status === "completed") {
      return NextResponse.json({ ok: false, error: "Protokol je již podepsán." }, { status: 409 });
    }

    const token = generateHandoverPublicSignToken();
    const expiresAt = new Date(Date.now() + HANDOVER_SIGN_LINK_TTL_MS);

    await db.collection(HANDOVER_PUBLIC_SIGN_TOKENS).doc(token).set({
      companyId,
      protocolId,
      jobId,
      expiresAt: FieldValue.serverTimestamp(),
      expiresAtMs: expiresAt.getTime(),
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: caller.uid,
      usedAt: null,
    });

    await pref.set(
      {
        status: "sent",
        sentToCustomer: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        activityHistory: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "public_sign_link_created",
          byUserId: caller.uid,
          byDisplayName: null,
          detail: "Vytvořen odkaz k vzdálenému podpisu",
        }),
      },
      { merge: true }
    );

    const origin = String(body.origin ?? request.nextUrl.origin).replace(/\/$/, "");
    const url = handoverPublicSignUrl(origin, token);

    return NextResponse.json({
      ok: true,
      url,
      expiresAt: expiresAt.toISOString(),
      token,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
