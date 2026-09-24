import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessChatMessage,
  findChatAttachment,
  loadChatMessageForAccess,
} from "@/lib/chat-attachment-access-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";

export const dynamic = "force-dynamic";

type CreateBody = {
  companyId?: string;
  messageId?: string;
  attachmentId?: string;
  analysisId?: string;
  assignmentTarget?: "job" | "overhead" | "pending";
  jobId?: string | null;
  jobName?: string | null;
  form?: {
    number?: string;
    entityName?: string;
    description?: string;
    date?: string;
    amountNet?: number;
    vatAmount?: number;
    amountGross?: number;
    vatRate?: number;
    currency?: "CZK" | "EUR";
    costCategory?: string;
    dueDate?: string;
    requiresPayment?: boolean;
    paymentMethod?: string;
  };
};

async function copyToDocumentStorage(
  srcPath: string,
  destPath: string
): Promise<{ fileUrl: string | null; storagePath: string }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) return { fileUrl: null, storagePath: destPath };
  const src = srcPath.replace(/^\//, "");
  const dest = destPath.replace(/^\//, "");
  const srcFile = bucket.file(src);
  const destFile = bucket.file(dest);
  const [srcExists] = await srcFile.exists();
  if (srcExists) await srcFile.copy(destFile);
  const [meta] = await destFile.getMetadata();
  const rawToken = meta.metadata?.firebaseStorageDownloadTokens;
  const token =
    typeof rawToken === "string" ? rawToken.split(",")[0]?.trim() : null;
  let fileUrl: string | null = null;
  if (token) {
    const enc = encodeURIComponent(dest);
    fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
  }
  return { fileUrl, storagePath: dest };
}

function patchAttachments(
  attachments: ChatAttachmentMeta[],
  attachmentId: string,
  patch: Partial<ChatAttachmentMeta>
): ChatAttachmentMeta[] {
  return attachments.map((a) => (a.id === attachmentId ? { ...a, ...patch } : a));
}

export async function POST(request: NextRequest) {
  const perm = await verifyCompanyPortalMutation(request, "documents");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
  }

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const messageId = String(body.messageId ?? "").trim();
  const attachmentId = String(body.attachmentId ?? "").trim();
  const form = body.form ?? {};

  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (!messageId || !attachmentId) {
    return NextResponse.json({ ok: false, error: "Chybí messageId nebo attachmentId." }, { status: 400 });
  }
  if (!String(form.number ?? "").trim() || !String(form.entityName ?? "").trim()) {
    return NextResponse.json(
      { ok: false, error: "Vyplňte číslo dokladu a dodavatele." },
      { status: 400 }
    );
  }

  const loaded = await loadChatMessageForAccess(db, companyId, messageId);
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  }
  if (
    !callerCanAccessChatMessage(
      { uid: perm.caller.uid, role: perm.caller.role, companyId },
      loaded.data
    )
  ) {
    return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
  }

  const att = findChatAttachment(loaded.attachments, attachmentId);
  if (!att?.storagePath) {
    return NextResponse.json({ ok: false, error: "Příloha nenalezena." }, { status: 404 });
  }

  const target = body.assignmentTarget ?? "pending";
  const jobId = target === "job" ? String(body.jobId ?? "").trim() || null : null;
  if (target === "job" && !jobId) {
    return NextResponse.json({ ok: false, error: "Vyberte zakázku." }, { status: 400 });
  }

  const assignmentType =
    target === "job" ? "job_cost" : target === "overhead" ? "company" : "pending_assignment";

  const amountNet = Number(form.amountNet) || 0;
  const vatAmount = Number(form.vatAmount) || 0;
  const amountGross = Number(form.amountGross) || amountNet + vatAmount;
  const vatRate = Number(form.vatRate) || 0;
  const currency = form.currency === "EUR" ? "EUR" : "CZK";

  const docRef = db.collection("companies").doc(companyId).collection("documents").doc();
  const safeName = att.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
  const destPath = `companies/${companyId}/documents/${docRef.id}/${safeName}`;
  const copied = await copyToDocumentStorage(att.storagePath, destPath);

  const conversationId = String(loaded.data.conversationId ?? "company");

  await docRef.set({
    number: String(form.number).trim(),
    entityName: String(form.entityName).trim(),
    description: String(form.description ?? "").trim(),
    date: String(form.date ?? new Date().toISOString().slice(0, 10)),
    type: "received",
    documentKind: "prijate",
    currency,
    amount: amountNet,
    amountNet,
    amountGross,
    vatAmount,
    vatRate,
    dphSazba: vatRate,
    vat: vatRate,
    castka: amountGross,
    amountCZK: currency === "CZK" ? amountGross : amountGross,
    castkaCZK: currency === "CZK" ? amountGross : amountGross,
    sDPH: true,
    organizationId: companyId,
    createdBy: perm.caller.uid,
    uploadedBy: perm.caller.uid,
    assignmentType,
    jobId,
    zakazkaId: jobId,
    jobName: target === "job" ? body.jobName ?? null : null,
    costCategory: form.costCategory ?? "other",
    requiresPayment: Boolean(form.requiresPayment),
    dueDate: form.dueDate?.trim() || null,
    paymentMethod: form.paymentMethod ?? null,
    fileUrl: copied.fileUrl ?? att.downloadUrl ?? null,
    fileName: att.fileName,
    mimeType: att.mimeType,
    storagePath: copied.storagePath,
    source: "internal-chat",
    sourceType: "chat",
    sourceChatMessageId: messageId,
    sourceAttachmentId: attachmentId,
    sourceConversationId: conversationId,
    chatAnalysisId: body.analysisId ?? att.aiDocumentAnalysisId ?? null,
    isDeleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const msgRef = db.collection("companies").doc(companyId).collection("chat").doc(messageId);
  const createdDocumentType =
    target === "job" ? "job_cost" : target === "overhead" ? "overhead" : "pending";

  await msgRef.update({
    attachments: patchAttachments(loaded.attachments, attachmentId, {
      linkedDocumentId: docRef.id,
      createdDocumentId: docRef.id,
      createdDocumentType,
      createdDocumentAt: FieldValue.serverTimestamp(),
      source: "chat-ai",
      analysisStatus: "saved",
    }),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const auditType =
    target === "job"
      ? "DOCUMENT_ASSIGNED_TO_JOB"
      : target === "overhead"
        ? "DOCUMENT_CREATED_AS_OVERHEAD"
        : "DOCUMENT_CREATED_FROM_CHAT";

  await db.collection("companies").doc(companyId).collection("activityLogs").add({
    organizationId: companyId,
    companyId,
    userId: perm.caller.uid,
    actionType: auditType,
    actionLabel: auditType,
    entityType: "document",
    entityId: docRef.id,
    metadata: {
      messageId,
      attachmentId,
      jobId,
      source: "internal-chat",
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    ok: true,
    documentId: docRef.id,
    assignmentType,
    jobId,
  });
}
