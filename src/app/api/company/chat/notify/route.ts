import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { createNotification } from "@/lib/notification-service/notification-service";

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
    previewText?: string;
    conversationId?: string;
    hasAttachment?: boolean;
    groupTitle?: string;
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

  const recipients = [
    ...(Array.isArray(body.recipientUserIds) ? body.recipientUserIds : []),
    ...(body.recipientUserId ? [body.recipientUserId] : []),
  ]
    .map(String)
    .filter(Boolean)
    .filter((uid) => uid !== perm.caller.uid);

  const uniqueRecipients = [...new Set(recipients)];
  if (!uniqueRecipients.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const senderName = String(body.senderName ?? "RAJMONDATA").trim();
  const conv = encodeURIComponent(String(body.conversationId ?? "company"));
  const groupTitle = String(body.groupTitle ?? "").trim();
  const attachmentLine = body.hasAttachment ? "Poslal fotografii." : "";
  const preview = String(body.previewText ?? "").slice(0, 160) || "Nová zpráva.";

  let sent = 0;
  for (const recipientUserId of uniqueRecipients) {
    const title = groupTitle
      ? groupTitle
      : `Nová zpráva od ${senderName}`;
    const bodyText = groupTitle
      ? `${senderName}: ${attachmentLine || preview}`
      : attachmentLine || preview;

    await createNotification({
      recipientUserId,
      organizationId: companyId,
      type: "SYSTEM_ALERT",
      title,
      body: bodyText,
      url: `/portal/chat?c=${conv}`,
      entityType: "system",
      entityId: body.conversationId ?? "company",
      category: "message",
      eventId: `chat-${recipientUserId}-${body.conversationId ?? "c"}-${Date.now()}`,
      source: "chat",
    });
    sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
}
