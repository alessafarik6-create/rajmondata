import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessChatMessage,
  findChatAttachment,
  loadChatMessageForAccess,
} from "@/lib/chat-attachment-access-server";
import {
  downloadChatAttachmentBuffer,
  fetchUrlBuffer,
} from "@/lib/chat-attachment-download-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function isDocumentLikeMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m.startsWith("image/") ||
    m.includes("pdf") ||
    m === "application/pdf"
  );
}

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearerWithPortalAccess(
      request.headers.get("authorization"),
      { moduleId: "chat", method: "POST" }
    );
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }
    const { caller, db } = v;
    const companyId = caller.companyId;

    const callerForAi = {
      uid: caller.uid,
      companyId,
      role: caller.role,
      globalRoles: caller.globalRoles,
      isSuperAdmin: caller.globalRoles.includes("super_admin"),
    };

    let body: {
      companyId?: string;
      messageId?: string;
      attachmentId?: string;
      force?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const messageId = String(body.messageId ?? "").trim();
    const attachmentId = String(body.attachmentId ?? "").trim();
    if (!messageId || !attachmentId) {
      return NextResponse.json({ ok: false, error: "Chybí messageId nebo attachmentId." }, { status: 400 });
    }

    const loaded = await loadChatMessageForAccess(db, companyId, messageId);
    if (!loaded.ok) {
      return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
    }
    if (
      !callerCanAccessChatMessage(
        { uid: caller.uid, role: caller.role, companyId },
        loaded.data
      )
    ) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const att = findChatAttachment(loaded.attachments, attachmentId);
    if (!att) {
      return NextResponse.json({ ok: false, error: "Příloha nenalezena." }, { status: 404 });
    }
    if (!isDocumentLikeMime(att.mimeType)) {
      return NextResponse.json(
        { ok: false, error: "Tento typ souboru nelze analyzovat jako doklad." },
        { status: 400 }
      );
    }

    if (
      !body.force &&
      att.aiDocumentAnalysisId &&
      (att.analysisStatus === "recognized" ||
        att.analysisStatus === "needs_review" ||
        att.analysisStatus === "saved")
    ) {
      const analysisSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("chatAttachmentAnalyses")
        .doc(att.aiDocumentAnalysisId)
        .get();
      if (analysisSnap.exists) {
        return NextResponse.json({
          ok: true,
          cached: true,
          analysisId: att.aiDocumentAnalysisId,
          analysisStatus: att.analysisStatus,
          ...(analysisSnap.data() as Record<string, unknown>),
        });
      }
    }

    if (!callerCanUseDocumentAi(callerForAi)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění používat AI analýzu dokladů." },
        { status: 403 }
      );
    }

    let buffer =
      (att.storagePath ? await downloadChatAttachmentBuffer(att.storagePath) : null) ??
      (att.downloadUrl ? await fetchUrlBuffer(att.downloadUrl) : null);
    if (!buffer?.length) {
      return NextResponse.json(
        { ok: false, error: "Soubor přílohy se nepodařilo načíst." },
        { status: 404 }
      );
    }

    const msgRef = db.collection("companies").doc(companyId).collection("chat").doc(messageId);
    const markAnalyzing = loaded.attachments.map((a) =>
      a.id === attachmentId ? { ...a, analysisStatus: "analyzing" as const } : a
    );
    await msgRef.update({ attachments: markAnalyzing, updatedAt: FieldValue.serverTimestamp() });

    const outcome = await analyzeCompanyDocument({
      db,
      companyId,
      fileBuffer: buffer,
      mimeType: att.mimeType,
      fileName: att.fileName,
    });

    if (!outcome.ok) {
      const errAttachments = loaded.attachments.map((a) =>
        a.id === attachmentId ? { ...a, analysisStatus: "error" as const } : a
      );
      await msgRef.update({ attachments: errAttachments });
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    const analysisId = `ca_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    const analysisStatus = outcome.confidence >= 0.75 && outcome.readable ? "recognized" : "needs_review";

    const analysisDoc = {
      id: analysisId,
      organizationId: companyId,
      messageId,
      attachmentId,
      conversationId: String(loaded.data.conversationId ?? "company"),
      analysisStatus,
      readable: outcome.readable,
      unreadableReason: outcome.unreadableReason,
      formPatch: outcome.formPatch,
      direction: outcome.direction,
      warnings: outcome.warnings,
      confidence: outcome.confidence,
      filledFields: outcome.filledFields,
      lowConfidenceFields: outcome.lowConfidenceFields,
      duplicateCandidates: outcome.duplicateCandidates,
      suggestedJobs: outcome.suggestedJobs,
      supplierMatch: outcome.supplierMatch,
      model: outcome.model,
      searchableText: outcome.searchableText,
      aiMeta: outcome.aiMeta,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
    };

    await db
      .collection("companies")
      .doc(companyId)
      .collection("chatAttachmentAnalyses")
      .doc(analysisId)
      .set(analysisDoc, { merge: true });

    const nextAttachments = loaded.attachments.map((a) =>
      a.id === attachmentId
        ? {
            ...a,
            aiDocumentAnalysisId: analysisId,
            analysisStatus,
          }
        : a
    );
    await msgRef.update({
      attachments: nextAttachments,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection("companies").doc(companyId).collection("activityLogs").add({
      organizationId: companyId,
      companyId,
      userId: caller.uid,
      actionType: "CHAT_ATTACHMENT_ANALYZED",
      actionLabel: "CHAT_ATTACHMENT_ANALYZED",
      entityType: "chat_message",
      entityId: messageId,
      metadata: {
        attachmentId,
        analysisId,
        analysisStatus,
        confidence: outcome.confidence,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      cached: false,
      analysisId,
      analysisStatus,
      readable: outcome.readable,
      unreadableReason: outcome.unreadableReason,
      formPatch: outcome.formPatch,
      direction: outcome.direction,
      warnings: outcome.warnings,
      confidence: outcome.confidence,
      filledFields: outcome.filledFields,
      lowConfidenceFields: outcome.lowConfidenceFields,
      duplicateCandidates: outcome.duplicateCandidates,
      suggestedJobs: outcome.suggestedJobs,
      supplierMatch: outcome.supplierMatch,
      model: outcome.model,
      searchableText: outcome.searchableText,
      aiMeta: outcome.aiMeta,
    });
  } catch (err) {
    console.error("[chat/analyze-attachment]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Analýza přílohy se nezdařila." },
      { status: 500 }
    );
  }
}
