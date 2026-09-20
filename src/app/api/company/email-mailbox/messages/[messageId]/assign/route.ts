import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";

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
    /** Explicitní souhlas se zveřejněním obsahu u zakázky. */
    shareWithJob?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const { messageId } = await ctx.params;

  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const jobId = body.jobId ? String(body.jobId).trim() : null;
  let jobLabel: string | null = null;
  let jobNumber: string | null = null;
  let jobName: string | null = null;

  if (jobId) {
    const jobCheck = await assertJobBelongsToCompany(perm.db, companyId, jobId);
    if (!jobCheck.ok) {
      return NextResponse.json({ ok: false, error: jobCheck.error }, { status: jobCheck.status });
    }
    jobLabel = jobCheck.jobLabel;
    jobNumber = jobCheck.jobNumber;
    jobName = jobCheck.jobName;
  }

  const jobVisibility =
    body.shareWithJob === true && jobId ? ("shared" as const) : ("private" as const);

  await emailMessagesCol(perm.db, companyId)
    .doc(messageId)
    .update({
      customerId: body.customerId ?? null,
      jobId: jobId ?? null,
      jobLabel: jobId ? jobLabel : null,
      inquiryId: body.inquiryId ?? null,
      resolved: body.resolved ?? false,
      jobVisibility,
      aiReviewPending: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

  await logEmailMailboxAudit(perm.db, companyId, {
    actionType: "email_assignment_changed",
    actionLabel: "Změna přiřazení e-mailu",
    userId: perm.caller.uid,
    entityId: messageId,
    metadata: {
      customerId: body.customerId ?? null,
      jobId: jobId ?? null,
      jobLabel,
      jobVisibility,
    },
  });

  return NextResponse.json({
    ok: true,
    success: true,
    jobVisibility,
    jobId,
    jobNumber,
    jobName,
    jobLabel,
  });
}
