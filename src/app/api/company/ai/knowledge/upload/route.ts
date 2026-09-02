import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { processKnowledgeDocument } from "@/lib/ai/knowledge-service";
import {
  AI_KNOWLEDGE_DOCUMENTS_COLLECTION,
  type AiKnowledgeCategory,
} from "@/lib/ai/ai-center-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_MIME = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${token}`;
}

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    const bucket = getAdminStorageBucket();
    if (!db || !auth || !bucket) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (!callerCanManageAiCenter(caller)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění nahrávat znalosti." }, { status: 403 });
    }

    const form = await request.formData();
    const companyId = String(form.get("companyId") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "general").trim() as AiKnowledgeCategory;
    const file = form.get("file");

    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Chybí soubor." }, { status: 400 });
    }

    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.some((m) => mimeType.includes(m.split("/")[1] ?? m))) {
      if (!mimeType.includes("pdf") && !mimeType.includes("text")) {
        return NextResponse.json(
          { ok: false, error: "Podporované formáty: PDF, TXT, DOCX." },
          { status: 400 }
        );
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ ok: false, error: "Soubor je prázdný." }, { status: 400 });
    }
    if (buffer.length > 15 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Maximální velikost je 15 MB." }, { status: 400 });
    }

    const documentId = randomUUID();
    const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120);
    const storagePath = `companies/${companyId}/ai-knowledge/${documentId}/${safeName}`;
    const token = randomUUID();
    const storageFile = bucket.file(storagePath);
    await storageFile.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });

    const downloadUrl = storageDownloadUrl(bucket.name, storagePath, token);
    const docRef = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
      .doc(documentId);

    await docRef.set({
      companyId,
      title: title || safeName,
      fileName: safeName,
      mimeType,
      storagePath,
      downloadUrl,
      category,
      active: true,
      status: "pending",
      chunkCount: 0,
      errorMessage: null,
      uploadedByUid: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const processed = await processKnowledgeDocument(db, companyId, documentId, buffer, mimeType);
    if (!processed.ok) {
      return NextResponse.json(
        { ok: false, error: processed.error, documentId },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      documentId,
      chunkCount: processed.chunkCount,
    });
  } catch (err) {
    console.error("[ai/knowledge/upload]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Nahrání znalostí se nezdařilo." }, { status: 500 });
  }
}
