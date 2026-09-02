import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { processKnowledgeDocumentFromStorage } from "@/lib/ai/knowledge-service";
import { AI_KNOWLEDGE_MAX_FILE_BYTES } from "@/lib/ai/knowledge-upload-config";
import type { AiKnowledgeCategory } from "@/lib/ai/ai-center-types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  documentId?: string;
  title?: string;
  category?: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  storagePath?: string;
  downloadUrl?: string;
};

function jsonError(
  status: number,
  error: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ ok: false, error, message, ...extra }, { status });
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
    if (!caller) {
      return jsonError(401, "UNAUTHORIZED", "Neautorizováno.");
    }
    if (!callerCanManageAiCenter(caller)) {
      return jsonError(403, "FORBIDDEN", "Nemáte oprávnění nahrávat znalosti.");
    }

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return jsonError(400, "INVALID_JSON", "Neplatný JSON požadavek.");
    }

    const companyId = String(body.companyId ?? "").trim();
    const documentId = String(body.documentId ?? "").trim();
    const storagePath = String(body.storagePath ?? "").trim();
    const downloadUrl = String(body.downloadUrl ?? "").trim();
    const fileName = String(body.fileName ?? "").trim();
    const mimeType = String(body.mimeType ?? "application/octet-stream").trim();
    const title = String(body.title ?? fileName).trim();
    const category = String(body.category ?? "general").trim() as AiKnowledgeCategory;
    const fileSizeBytes = Number(body.fileSizeBytes ?? 0);

    if (!companyId || !documentId || !storagePath || !downloadUrl || !fileName) {
      return jsonError(400, "MISSING_FIELDS", "Chybí povinná metadata souboru.");
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return jsonError(403, "FORBIDDEN", "Přístup odepřen.");
    }
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return jsonError(400, "INVALID_SIZE", "Neplatná velikost souboru.");
    }
    if (fileSizeBytes > AI_KNOWLEDGE_MAX_FILE_BYTES) {
      return jsonError(413, "FILE_TOO_LARGE", "Soubor je příliš velký (max. 15 MB).");
    }
    if (!storagePath.startsWith(`companies/${companyId}/ai-knowledge/`)) {
      return jsonError(400, "INVALID_STORAGE_PATH", "Neplatná cesta souboru.");
    }

    const processed = await processKnowledgeDocumentFromStorage(db, bucket, {
      companyId,
      documentId,
      title,
      category,
      fileName,
      mimeType,
      fileSizeBytes,
      storagePath,
      downloadUrl,
      uploadedByUid: caller.uid,
    });

    if (!processed.ok) {
      return jsonError(422, processed.code ?? "PDF_PROCESSING_FAILED", processed.error, {
        documentId,
      });
    }

    return NextResponse.json({
      ok: true,
      documentId,
      chunkCount: processed.chunkCount,
    });
  } catch (err) {
    console.error("[ai/knowledge/process]", errorMessageFromUnknown(err));
    return jsonError(500, "INTERNAL_ERROR", "Zpracování znalostí se nezdařilo.");
  }
}
