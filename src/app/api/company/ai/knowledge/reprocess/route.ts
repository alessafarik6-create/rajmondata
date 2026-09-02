import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { processKnowledgeDocument } from "@/lib/ai/knowledge-service";
import { AI_KNOWLEDGE_DOCUMENTS_COLLECTION } from "@/lib/ai/ai-center-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = { companyId?: string; documentId?: string };

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    const bucket = getAdminStorageBucket();
    if (!db || !auth || !bucket) {
      return jsonError(503, "SERVER_NOT_CONFIGURED", "Server není nakonfigurován.");
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) return jsonError(401, "UNAUTHORIZED", "Neautorizováno.");
    if (!callerCanManageAiCenter(caller)) {
      return jsonError(403, "FORBIDDEN", "Nemáte oprávnění.");
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    const documentId = String(body.documentId ?? "").trim();
    if (!companyId || !documentId) {
      return jsonError(400, "MISSING_FIELDS", "Chybí companyId nebo documentId.");
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return jsonError(403, "FORBIDDEN", "Přístup odepřen.");
    }

    const docRef = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
      .doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return jsonError(404, "NOT_FOUND", "Dokument nebyl nalezen.");
    }
    const doc = snap.data() as Record<string, unknown>;
    const storagePath = String(doc.storagePath ?? "").trim();
    if (!storagePath) {
      return jsonError(400, "NO_STORAGE", "Dokument nemá uložený soubor.");
    }

    const [buffer] = await bucket.file(storagePath).download();
    const processed = await processKnowledgeDocument(
      db,
      companyId,
      documentId,
      buffer,
      String(doc.mimeType ?? "application/octet-stream"),
      String(doc.fileName ?? documentId)
    );

    if (!processed.ok) {
      return jsonError(422, processed.code ?? "PDF_PROCESSING_FAILED", processed.error);
    }

    return NextResponse.json({ ok: true, documentId, chunkCount: processed.chunkCount });
  } catch (err) {
    console.error("[ai/knowledge/reprocess]", errorMessageFromUnknown(err));
    return jsonError(500, "INTERNAL_ERROR", "Opětovné zpracování se nezdařilo.");
  }
}
