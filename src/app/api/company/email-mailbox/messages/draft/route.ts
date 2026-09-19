import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import {
  assertEmailAccountAccess,
  resolveAccountOwnerUserId,
} from "@/lib/email-mailbox/account-access";
import { loadEmailAccount } from "@/lib/email-mailbox/account-store";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    accountId?: string;
    to?: string[];
    subject?: string;
    textBody?: string;
    draftId?: string;
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

  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Chybí účet." }, { status: 400 });
  }

  const access = await assertEmailAccountAccess(perm.db, companyId, accountId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const account = await loadEmailAccount(perm.db, companyId, accountId);
  const ownerUserId = account ? resolveAccountOwnerUserId(account) : perm.caller.uid;

  const payload = {
    organizationId: companyId,
    emailAccountId: accountId,
    ownerUserId: ownerUserId || perm.caller.uid,
    from: "",
    to: body.to ?? [],
    subject: String(body.subject ?? ""),
    textBody: String(body.textBody ?? ""),
    direction: "outbound" as const,
    folder: "Drafts",
    isDraft: true,
    isRead: true,
    receivedAt: Timestamp.fromDate(new Date()),
    updatedAt: FieldValue.serverTimestamp(),
  };

  let id = body.draftId?.trim();
  if (id) {
    await emailMessagesCol(perm.db, companyId).doc(id).set(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } else {
    const ref = emailMessagesCol(perm.db, companyId).doc();
    id = ref.id;
    await ref.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await logEmailMailboxAudit(perm.db, companyId, {
    actionType: "email_draft_saved",
    actionLabel: "Uložen koncept e-mailu",
    userId: perm.caller.uid,
    entityId: id,
  });

  return NextResponse.json({ ok: true, draftId: id });
}
