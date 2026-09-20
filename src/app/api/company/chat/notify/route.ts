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
    senderName?: string;
    previewText?: string;
    conversationId?: string;
    hasAttachment?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const recipientUserId = String(body.recipientUserId ?? "").trim();
  if (!recipientUserId || recipientUserId === perm.caller.uid) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const senderName = String(body.senderName ?? "RAJMONDATA").trim();
  const conv = encodeURIComponent(String(body.conversationId ?? "company"));
  const bodyText = body.hasAttachment
    ? "Poslal fotografii."
    : String(body.previewText ?? "").slice(0, 160) || "Nová zpráva.";

  await createNotification({
    recipientUserId,
    organizationId: companyId,
    type: "SYSTEM_ALERT",
    title: `Nová zpráva od ${senderName}`,
    body: bodyText,
    url: `/portal/chat?c=${conv}`,
    entityType: "system",
    entityId: body.conversationId ?? "company",
    category: "message",
    eventId: `chat-${recipientUserId}-${Date.now()}`,
    source: "chat",
  });

  return NextResponse.json({ ok: true });
}
