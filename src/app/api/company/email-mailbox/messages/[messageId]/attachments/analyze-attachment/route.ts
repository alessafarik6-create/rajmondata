import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { downloadEmailAttachmentBuffer } from "@/lib/email-mailbox/attachment-access";
import { patchEmailAttachmentDocumentMeta } from "@/lib/email-mailbox/email-attachment-document-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ messageId: string }> };

function isDocumentLikeMime(mime: string, filename: string): boolean {
  const m = mime.toLowerCase();
  const fn = filename.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf") || fn.endsWith(".pdf");
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const perm = await requireEmailMailboxRead(request);
    if (!perm.ok) {
      return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
    }
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
    }

    let body: { companyId?: string; attachmentId?: string; force?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const companyId = String(body.companyId ?? perm.caller.companyId).trim();
    const attachmentId = String(body.attachmentId ?? "").trim();
    const { messageId } = await ctx.params;

    if (!emailMailboxTenantOk(perm.caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }
    if (!attachmentId) {
      return NextResponse.json({ ok: false, error: "Chybí attachmentId." }, { status: 400 });
    }

    const access = await assertMessageAccess(db, companyId, messageId, perm.caller.uid, "read");
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    const attachments = access.message.attachments ?? [];
    const att = attachments.find((a) => a.id === attachmentId);
    if (!att?.storagePath) {
      return NextResponse.json({ ok: false, error: "Příloha nenalezena." }, { status: 404 });
    }
    if (!isDocumentLikeMime(att.contentType, att.filename)) {
      return NextResponse.json(
        { ok: false, error: "Tento typ souboru nelze analyzovat jako doklad." },
        { status: 400 }
      );
    }

    const callerForAi = {
      uid: perm.caller.uid,
      companyId,
      role: perm.caller.role,
      globalRoles: perm.caller.globalRoles ?? [],
      isSuperAdmin: (perm.caller.globalRoles ?? []).includes("super_admin"),
    };

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
        .collection("emailAttachmentAnalyses")
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

    const { buffer } = await downloadEmailAttachmentBuffer(att.storagePath);
    if (!buffer?.length) {
      return NextResponse.json(
        { ok: false, error: "Soubor přílohy se nepodařilo načíst." },
        { status: 404 }
      );
    }

    const msgRef = emailMessagesCol(db, companyId).doc(messageId);
    await msgRef.update({
      attachments: patchEmailAttachmentDocumentMeta(attachments, attachmentId, {
        analysisStatus: "analyzing",
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const outcome = await analyzeCompanyDocument({
      db,
      companyId,
      fileBuffer: buffer,
      mimeType: att.contentType,
      fileName: att.filename,
    });

    if (!outcome.ok) {
      await msgRef.update({
        attachments: patchEmailAttachmentDocumentMeta(attachments, attachmentId, {
          analysisStatus: "error",
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    const analysisId = `ea_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    const analysisStatus =
      outcome.confidence >= 0.75 && outcome.readable ? "recognized" : "needs_review";

    await db
      .collection("companies")
      .doc(companyId)
      .collection("emailAttachmentAnalyses")
      .doc(analysisId)
      .set(
        {
          id: analysisId,
          organizationId: companyId,
          messageId,
          attachmentId,
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
          aiMeta: outcome.aiMeta,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: perm.caller.uid,
        },
        { merge: true }
      );

    const nextAttachments = patchEmailAttachmentDocumentMeta(attachments, attachmentId, {
      aiDocumentAnalysisId: analysisId,
      analysisStatus,
    });
    await msgRef.update({
      attachments: nextAttachments as EmailMessageAttachmentMeta[],
      updatedAt: FieldValue.serverTimestamp(),
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
      duplicateCandidates: outcome.duplicateCandidates,
      suggestedJobs: outcome.suggestedJobs,
      supplierMatch: outcome.supplierMatch,
    });
  } catch (err) {
    console.error("[email/analyze-attachment]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Analýza přílohy se nezdařila." },
      { status: 500 }
    );
  }
}
