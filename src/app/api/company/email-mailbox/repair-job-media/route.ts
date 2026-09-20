import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";
import { repairEmailAttachmentJobMediaForJob } from "@/lib/email-mailbox/email-attachment-job-media-server";
import { listEmailAccountsAccessibleToUser } from "@/lib/email-mailbox/account-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  let body: { companyId?: string; jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Chybí jobId." }, { status: 400 });
  }
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const jobMeta = await assertJobBelongsToCompany(db, companyId, jobId);
  if (!jobMeta.ok) {
    return NextResponse.json({ ok: false, error: jobMeta.error }, { status: jobMeta.status });
  }

  const accounts = await listEmailAccountsAccessibleToUser(
    db,
    companyId,
    perm.caller.uid,
    "read"
  );
  const mailboxEmailByAccountId = new Map(accounts.map((a) => [a.id, a.email]));

  const stats = await repairEmailAttachmentJobMediaForJob({
    db,
    companyId,
    jobId,
    userId: perm.caller.uid,
    mailboxEmailByAccountId,
  });

  return NextResponse.json({ ok: true, ...stats });
}
