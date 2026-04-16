import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  decodePngDataUrlToBuffer,
  isPngDataUrl,
  type OrganizationSignature,
} from "@/lib/organization-signature";

export const dynamic = "force-dynamic";

type Body = { companyId?: string; pngDataUrl?: string };

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}

async function loadExistingSignature(
  db: ReturnType<typeof getAdminFirestore>,
  companyId: string
): Promise<{ url?: string; storagePath?: string } | null> {
  if (!db) return null;
  const c = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const o = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
  const raw =
    (c.exists ? (c.data() as { organizationSignature?: unknown }).organizationSignature : undefined) ??
    (o.exists ? (o.data() as { organizationSignature?: unknown }).organizationSignature : undefined);
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url : undefined;
  const storagePath = typeof r.storagePath === "string" ? r.storagePath : undefined;
  return url || storagePath ? { url, storagePath } : null;
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });

  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Nemáte přístup k organizaci." }, { status: 403 });
  }

  const existing = await loadExistingSignature(db, companyId);
  return NextResponse.json({ ok: true, signature: existing });
}

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  const bucket = getAdminStorageBucket();
  if (!db || !auth || !bucket) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  if (!callerCanManageOrgEmailSettings(caller)) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const pngDataUrl = String(body.pngDataUrl ?? "").trim();
  if (!companyId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 400 });
  }
  if (!pngDataUrl) {
    return NextResponse.json({ ok: false, error: "Chybí podpis." }, { status: 400 });
  }
  if (!isPngDataUrl(pngDataUrl)) {
    return NextResponse.json({ ok: false, error: "Podpis musí být PNG (data URL)." }, { status: 400 });
  }

  const buf = decodePngDataUrlToBuffer(pngDataUrl);
  if (buf.length < 2500) {
    return NextResponse.json({ ok: false, error: "Podpis je prázdný nebo příliš malý." }, { status: 400 });
  }
  if (buf.length > 1_500_000) {
    return NextResponse.json({ ok: false, error: "Podpis je příliš velký." }, { status: 400 });
  }

  // Delete previous signature file if present.
  const existing = await loadExistingSignature(db, companyId);
  if (existing?.storagePath) {
    try {
      await bucket.file(existing.storagePath).delete({ ignoreNotFound: true });
    } catch {
      // ignore
    }
  }

  const token = randomUUID();
  const storagePath = `companies/${companyId}/organizationSignature/signature_${Date.now()}.png`;
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType: "image/png",
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
      cacheControl: "public, max-age=31536000",
    },
    resumable: false,
  });

  const url = storageDownloadUrl(bucket.name, storagePath, token);
  const signature: OrganizationSignature = {
    url,
    storagePath,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
    contentType: "image/png",
  };

  const payload = { organizationSignature: signature, updatedAt: FieldValue.serverTimestamp() };
  await Promise.all([
    db.collection(COMPANIES_COLLECTION).doc(companyId).set(payload, { merge: true }),
    db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).set(payload, { merge: true }),
  ]);

  return NextResponse.json({ ok: true, signature });
}

export async function DELETE(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  const bucket = getAdminStorageBucket();
  if (!db || !auth || !bucket) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  if (!callerCanManageOrgEmailSettings(caller)) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  if (!companyId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 400 });
  }

  const existing = await loadExistingSignature(db, companyId);
  if (existing?.storagePath) {
    try {
      await bucket.file(existing.storagePath).delete({ ignoreNotFound: true });
    } catch {
      // ignore
    }
  }

  await Promise.all([
    db.collection(COMPANIES_COLLECTION).doc(companyId).set(
      { organizationSignature: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    ),
    db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).set(
      { organizationSignature: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    ),
  ]);

  return NextResponse.json({ ok: true });
}

