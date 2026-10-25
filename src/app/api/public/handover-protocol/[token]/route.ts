import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  getAdminFirestore,
  getAdminStorageBucket,
} from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { loadHandoverProtocolPdfHtml } from "@/lib/handover-protocol-load-admin";
import { HANDOVER_PUBLIC_SIGN_TOKENS } from "@/lib/handover-protocol-public-sign";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}

async function resolveToken(db: Firestore, token: string) {
  const linkSnap = await db.collection(HANDOVER_PUBLIC_SIGN_TOKENS).doc(token).get();
  if (!linkSnap.exists) return { ok: false as const, error: "Odkaz neexistuje.", status: 404 };
  const link = linkSnap.data() ?? {};
  if (link.usedAt) {
    return { ok: false as const, error: "Odkaz byl již použit.", status: 410 };
  }
  const expiresMs = Number(link.expiresAtMs ?? 0);
  if (expiresMs && Date.now() > expiresMs) {
    return { ok: false as const, error: "Platnost odkazu vypršela.", status: 410 };
  }
  const companyId = String(link.companyId ?? "").trim();
  const protocolId = String(link.protocolId ?? "").trim();
  if (!companyId || !protocolId) {
    return { ok: false as const, error: "Neplatný odkaz.", status: 400 };
  }
  return { ok: true as const, companyId, protocolId, linkRef: linkSnap.ref };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }
    const { token: raw } = await context.params;
    const token = decodeURIComponent(String(raw ?? "").trim());
    if (!token) return NextResponse.json({ ok: false, error: "Chybí token." }, { status: 400 });

    const resolved = await resolveToken(db, token);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }

    const built = await loadHandoverProtocolPdfHtml(db, resolved.companyId, resolved.protocolId);
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 404 });
    }

    const rec = built.protocol;
    const status = String(rec.status ?? "draft");
    if (status === "signed_by_customer" || status === "completed") {
      return NextResponse.json({ ok: false, error: "Protokol je již podepsán.", status: "signed" }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      html: built.html,
      protocolNumber: String(rec.protocolNumber ?? resolved.protocolId),
      jobName: String(rec.jobName ?? ""),
      customerName: String(rec.customerName ?? ""),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const ipHash = hashIp(clientIpFromHeaders(request.headers));
    const rl = await checkFirestoreRateLimit(db, `handover_public_sign:${ipHash}`, {
      limit: 8,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }

    const { token: raw } = await context.params;
    const token = decodeURIComponent(String(raw ?? "").trim());
    const body = (await request.json()) as {
      signatureDataUrl?: string;
      signerName?: string;
    };
    const dataUrl = String(body.signatureDataUrl ?? "").trim();
    const signerName = String(body.signerName ?? "").trim().slice(0, 200);
    if (!token || !dataUrl.startsWith("data:image/") || !signerName) {
      return NextResponse.json({ ok: false, error: "Chybí podpis nebo jméno." }, { status: 400 });
    }

    const resolved = await resolveToken(db, token);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }

    const { companyId, protocolId, linkRef } = resolved;
    const pref = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("handoverProtocols")
      .doc(protocolId);

    const built = await loadHandoverProtocolPdfHtml(db, companyId, protocolId);
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 404 });
    }

    const contentHash = createHash("sha256").update(built.html, "utf8").digest("hex");

    const base64 = dataUrl.split(",")[1] ?? "";
    const buf = Buffer.from(base64, "base64");
    let signatureUrl = dataUrl;
    let storagePath: string | null = null;
    const bucket = getAdminStorageBucket();
    if (bucket) {
      const fileToken = randomUUID();
      storagePath = `companies/${companyId}/handoverProtocols/${protocolId}/signatures/customer_public_${Date.now()}.png`;
      const file = bucket.file(storagePath);
      await file.save(buf, {
        contentType: "image/png",
        metadata: { metadata: { firebaseStorageDownloadTokens: fileToken } },
        resumable: false,
      });
      signatureUrl = storageDownloadUrl(bucket.name, storagePath, fileToken);
    }

    const signedAtIso = new Date().toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague";

    await pref.set(
      {
        status: "signed_by_customer",
        lockedAt: FieldValue.serverTimestamp(),
        customerSignature: {
          signedAt: FieldValue.serverTimestamp(),
          signedByUid: null,
          signedByName: signerName,
          signedByRole: "customer",
          signatureImageUrl: signatureUrl,
          signatureStoragePath: storagePath,
          signMethod: "public_link",
          verificationLevel: "simple",
        },
        signedDocumentHash: contentHash,
        signedDocumentVersion: String(built.protocol.protocolNumber ?? protocolId),
        activityHistory: FieldValue.arrayUnion({
          at: signedAtIso,
          action: "customer_signed_public",
          byUserId: null,
          byDisplayName: signerName,
          detail: `Vzdálený podpis (${tz})`,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await linkRef.set(
      {
        usedAt: FieldValue.serverTimestamp(),
        signerName,
      },
      { merge: true }
    );

    try {
      const builtSigned = await loadHandoverProtocolPdfHtml(db, companyId, protocolId);
      const htmlForPdf = builtSigned.ok ? builtSigned.html : built.html;
      const pdfBuffer = await renderStoredHtmlToPdfBuffer(htmlForPdf);
      if (bucket) {
        const pdfPath = `companies/${companyId}/handoverProtocols/${protocolId}/signed_${Date.now()}.pdf`;
        const pdfToken = randomUUID();
        await bucket.file(pdfPath).save(pdfBuffer, {
          contentType: "application/pdf",
          metadata: { metadata: { firebaseStorageDownloadTokens: pdfToken } },
          resumable: false,
        });
        await pref.set(
          {
            pdfStoragePath: pdfPath,
            pdfSavedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (pdfErr) {
      console.warn("[handover public sign] pdf save", pdfErr);
    }

    return NextResponse.json({ ok: true, message: "Předávací protokol byl úspěšně podepsán." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
