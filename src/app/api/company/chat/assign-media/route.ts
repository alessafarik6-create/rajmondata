import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";
import {
  findOrCreateChatAttachmentFolder,
  importChatAttachmentToJobMedia,
} from "@/lib/chat-job-media-server";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await verifyCompanyPortalMutation(request, "jobs");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  let body: {
    companyId?: string;
    jobId?: string;
    messageId?: string;
    conversationId?: string;
    attachmentIds?: string[];
    jobDisplayName?: string | null;
    senderLabel?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const jobId = String(body.jobId ?? "").trim();
  const messageId = String(body.messageId ?? "").trim();
  const conversationId = String(body.conversationId ?? "company").trim();
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String).filter(Boolean)
    : [];

  if (!companyId || companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (!jobId || !messageId || !attachmentIds.length) {
    return NextResponse.json({ ok: false, error: "Vyberte zakázku a přílohu." }, { status: 400 });
  }

  const jobMeta = await assertJobBelongsToCompany(db, companyId, jobId);
  if (!jobMeta.ok) {
    return NextResponse.json({ ok: false, error: jobMeta.error }, { status: jobMeta.status });
  }

  const msgRef = db.collection("companies").doc(companyId).collection("chat").doc(messageId);
  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) {
    return NextResponse.json({ ok: false, error: "Zpráva nenalezena." }, { status: 404 });
  }
  const msg = msgSnap.data() as Record<string, unknown>;
  const participantIds = Array.isArray(msg.participantIds)
    ? (msg.participantIds as string[])
    : [];
  const cid = String(msg.conversationId ?? "company");
  const uid = perm.caller.uid;
  const privileged = ["owner", "admin", "manager"].includes(String(perm.caller.role));
  const canAccess =
    cid === "company" ||
    !msg.conversationId ||
    participantIds.includes(uid) ||
    privileged;
  if (!canAccess) {
    return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
  }

  const attachments = (msg.attachments ?? []) as ChatAttachmentMeta[];
  const folder = await findOrCreateChatAttachmentFolder({
    db,
    companyId,
    jobId,
    userId: uid,
    senderLabel: body.senderLabel ?? null,
  });

  const results: Record<string, unknown>[] = [];
  const updated = attachments.map((a) => ({ ...a }));

  for (const attId of attachmentIds) {
    const att = updated.find((a) => a.id === attId);
    if (!att?.storagePath) {
      results.push({ attachmentId: attId, error: "Příloha chybí." });
      continue;
    }
    if (att.linkedJobId === jobId) {
      results.push({ attachmentId: attId, duplicate: true, jobId });
      continue;
    }
    const imported = await importChatAttachmentToJobMedia({
      db,
      companyId,
      jobId,
      jobDisplayName: body.jobDisplayName ?? jobMeta.jobName ?? null,
      folderId: folder.folderId,
      folderName: folder.folderName,
      messageId,
      conversationId,
      attachment: att,
      createdByUserId: uid,
      senderLabel: body.senderLabel ?? null,
    });
    if (!imported.ok) {
      results.push({ attachmentId: attId, error: imported.error });
      continue;
    }
    if (imported.duplicate) {
      results.push({ attachmentId: attId, duplicate: true, imageId: imported.imageId });
      att.linkedJobId = jobId;
      att.linkedJobName = body.jobDisplayName ?? jobMeta.jobName ?? jobId;
      att.linkedFolderId = folder.folderId;
      att.linkedJobMediaImageId = imported.imageId;
      continue;
    }
    att.linkedJobId = jobId;
    att.linkedJobName = body.jobDisplayName ?? jobMeta.jobName ?? jobId;
    att.linkedFolderId = folder.folderId;
    att.linkedJobMediaImageId = imported.imageId;
    results.push({
      attachmentId: attId,
      imageId: imported.imageId,
      folderId: folder.folderId,
      folderName: folder.folderName,
    });
  }

  await msgRef.update({
    attachments: updated,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, folder, results });
}
