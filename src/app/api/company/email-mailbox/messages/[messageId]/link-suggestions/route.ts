import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { suggestEmailJobLinks } from "@/lib/email-mailbox/job-link-suggest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "read");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const m = access.message;

  const suggestion = await suggestEmailJobLinks(perm.db, companyId, {
    from: m.from,
    subject: m.subject,
    textBody: m.textBody,
  });

  return NextResponse.json({
    ok: true,
    suggestion: {
      ...suggestion,
      fromAi: {
        customerId: m.suggestedCustomerId ?? null,
        jobId: m.suggestedJobId ?? null,
        jobLabel: m.suggestedJobLabel ?? null,
        confidence: m.jobMatchConfidence ?? null,
      },
    },
  });
}
