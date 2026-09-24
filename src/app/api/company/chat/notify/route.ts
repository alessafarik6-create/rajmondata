import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { createNotification } from "@/lib/notification-service/notification-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { resolveCompanyChatPushRecipientIds } from "@/lib/company-chat-push-recipients";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await verifyCompanyPortalMutation(request, "chat");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    recipientUserId?: string;
    recipientUserIds?: string[];
    senderName?: string;
    senderRole?: "employee" | "admin";
    previewText?: string;
    conversationId?: string;
    hasAttachment?: boolean;
    groupTitle?: string;
    companyBroadcast?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  let recipients = [
    ...(Array.isArray(body.recipientUserIds) ? body.recipientUserIds : []),
    ...(body.recipientUserId ? [body.recipientUserId] : []),
  ]
    .map(String)
    .filter(Boolean)
    .filter((uid) => uid !== perm.caller.uid);

  if (body.companyBroadcast) {
    const db = getAdminFirestore();
    if (db) {
      const senderRole = body.senderRole === "admin" ? "admin" : "employee";
      const resolved = await resolveCompanyChatPushRecipientIds(
        db,
        companyId,
        perm.caller.uid,
        senderRole
      );
      recipients = [...recipients, ...resolved];
    }
  }

  const uniqueRecipients = [...new Set(recipients)];
  if (!uniqueRecipients.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const senderName = String(body.senderName ?? "RAJMONDATA").trim();
  const conv = encodeURIComponent(String(body.conversationId ?? "company"));
  const groupTitle = String(body.groupTitle ?? "").trim();
  const attachmentLine = body.hasAttachment ? "Poslal fotografii." : "";
  const preview = String(body.previewText ?? "").slice(0, 160) || "Nová zpráva.";
  const senderIsAdmin = body.senderRole === "admin";
  const notifType = senderIsAdmin ? "CHAT_ADMIN_MESSAGE" : "CHAT_MESSAGE";
  const eventBase = `chat-${body.conversationId ?? "c"}-${Date.now()}`;

  const db = getAdminFirestore();

  let sent = 0;
  let pushOk = 0;
  for (const recipientUserId of uniqueRecipients) {
    let chatUrl = `/portal/chat?c=${conv}`;
    if (db) {
      const userSnap = await db.collection("users").doc(recipientUserId).get();
      const role = String(userSnap.data()?.role ?? "").trim();
      if (role === "employee") {
        chatUrl = `/portal/employee/messages?c=${conv}`;
      }
    }
    const title = groupTitle
      ? groupTitle
      : senderIsAdmin
        ? `Nová zpráva od ${senderName}`
        : `Nová zpráva od ${senderName}`;
    const bodyText = groupTitle
      ? `${senderName}: ${attachmentLine || preview}`
      : attachmentLine || preview;

    const result = await createNotification({
      recipientUserId,
      organizationId: companyId,
      type: notifType,
      title,
      body: bodyText,
      url: chatUrl,
      entityType: "system",
      entityId: body.conversationId ?? "company",
      conversationId: body.conversationId ?? "company",
      category: "message",
      eventId: `${eventBase}:${recipientUserId}`,
      source: "chat",
    });
    sent += 1;
    pushOk += result.pushOk;
  }

  return NextResponse.json({ ok: true, sent, pushOk });
}
