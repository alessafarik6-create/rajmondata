import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { findExistingDocumentForEmailAttachment } from "@/lib/email-mailbox/email-attachment-document-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await verifyCompanyPortalMutation(request, "documents");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
  }

  const companyId = String(
    request.nextUrl.searchParams.get("companyId") ?? perm.caller.companyId
  ).trim();
  const attachmentId = String(request.nextUrl.searchParams.get("attachmentId") ?? "").trim();
  const { messageId } = await ctx.params;

  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (!attachmentId) {
    return NextResponse.json({ ok: false, error: "Chybí attachmentId." }, { status: 400 });
  }

  const found = await findExistingDocumentForEmailAttachment(
    db,
    companyId,
    messageId,
    attachmentId
  );

  return NextResponse.json({
    ok: true,
    documentId: found.exists ? found.id : null,
  });
}
