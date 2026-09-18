import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    customerId?: string | null;
    jobId?: string | null;
    inquiryId?: string | null;
    resolved?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const { messageId } = await ctx.params;

  await emailMessagesCol(perm.db, companyId)
    .doc(messageId)
    .update({
      customerId: body.customerId ?? null,
      jobId: body.jobId ?? null,
      inquiryId: body.inquiryId ?? null,
      resolved: body.resolved ?? false,
      aiReviewPending: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

  return NextResponse.json({ ok: true });
}
