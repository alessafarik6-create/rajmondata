import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  assertEmailAttachmentAccess,
  downloadEmailAttachmentBuffer,
} from "@/lib/email-mailbox/attachment-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string; attachmentId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId, attachmentId } = await ctx.params;
  const access = await assertEmailAttachmentAccess(
    db,
    companyId,
    messageId,
    attachmentId,
    perm.caller.uid,
    "read"
  );
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const inline = request.nextUrl.searchParams.get("disposition") === "inline";
  try {
    const { buffer, contentType } = await downloadEmailAttachmentBuffer(
      access.attachment.storagePath!
    );
    const filename = access.attachment.filename || "priloha";
    const encoded = encodeURIComponent(filename).replace(/'/g, "%27");
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType || access.attachment.contentType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `${
          inline ? "inline" : "attachment"
        }; filename*=UTF-8''${encoded}`,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Stažení selhalo." }, { status: 500 });
  }
}
