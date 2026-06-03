import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  assertCallerCanHandoverProtocolCustomer,
  assertCallerCanHandoverProtocolStaff,
} from "@/lib/handover-protocol-api-auth";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function historyEvent(
  action: string,
  caller: { uid: string; displayName?: string | null },
  detail?: string | null
) {
  return {
    at: new Date().toISOString(),
    action,
    byUserId: caller.uid,
    byDisplayName: caller.displayName ?? null,
    detail: detail ?? null,
  };
}

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

    const body = (await request.json()) as {
      companyId?: string;
      protocolId?: string;
      role?: "customer" | "contractor";
      signatureDataUrl?: string;
    };
    const companyId = String(body.companyId ?? "").trim();
    const protocolId = String(body.protocolId ?? "").trim();
    const role = body.role === "customer" ? "customer" : "contractor";
    const dataUrl = String(body.signatureDataUrl ?? "").trim();
    if (!companyId || !protocolId || !dataUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Chybí údaje nebo podpis." }, { status: 400 });
    }

    const ref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("handoverProtocols").doc(protocolId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Protokol neexistuje." }, { status: 404 });
    }
    const rec = (snap.data() ?? {}) as Record<string, unknown>;
    const jobId = String(rec.jobId ?? "").trim();

    if (role === "customer") {
      const gate = await assertCallerCanHandoverProtocolCustomer(db, caller, companyId, rec);
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    } else {
      const gate = await assertCallerCanHandoverProtocolStaff(db, caller, companyId, jobId);
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const userSnap = await db.collection("users").doc(caller.uid).get();
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const actorName =
      String(userData.displayName ?? userData.name ?? "").trim() ||
      String(userData.email ?? "").trim() ||
      null;
    const actorMeta = { uid: caller.uid, displayName: actorName };

    const base64 = dataUrl.split(",")[1] ?? "";
    const buf = Buffer.from(base64, "base64");
    let signatureUrl = dataUrl;
    let storagePath: string | null = null;
    const bucket = getAdminStorageBucket();
    if (bucket) {
      const token = randomUUID();
      storagePath = `companies/${companyId}/handoverProtocols/${protocolId}/signatures/${role}_${Date.now()}.png`;
      const file = bucket.file(storagePath);
      await file.save(buf, {
        contentType: "image/png",
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        resumable: false,
      });
      signatureUrl = storageDownloadUrl(bucket.name, storagePath, token);
    }

    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent");

    const sigField = role === "customer" ? "customerSignature" : "contractorSignature";
    const patch: Record<string, unknown> = {
      [sigField]: {
        signedAt: FieldValue.serverTimestamp(),
        signedByUid: caller.uid,
        signedByName: actorName,
        signedByRole: role === "customer" ? "customer" : caller.role,
        signatureImageUrl: signatureUrl,
        signatureStoragePath: storagePath,
        clientIp,
        userAgent,
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
      activityHistory: FieldValue.arrayUnion(
        historyEvent(
          role === "customer" ? "customer_signed" : "contractor_signed",
          actorMeta,
          role === "customer" ? "Podepsáno zákazníkem" : "Podepsáno zhotovitelem"
        )
      ),
    };
    if (role === "customer") {
      patch.status = "signed_by_customer";
    }

    await ref.set(patch, { merge: true });

    return NextResponse.json({ ok: true, status: role === "customer" ? "signed_by_customer" : rec.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
