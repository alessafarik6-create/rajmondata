import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { sendEmailFromAccount } from "@/lib/email-mailbox/send-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  let body: {
    companyId?: string;
    accountId?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    textBody?: string;
    htmlBody?: string;
    replyToMessageId?: string;
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
  const to = Array.isArray(body.to) ? body.to.map(String) : [];
  const subject = String(body.subject ?? "").trim();
  const textBody = String(body.textBody ?? "").trim();
  if (!accountId || !to.length || !subject || !textBody) {
    return NextResponse.json({ ok: false, error: "Vyplňte účet, příjemce, předmět a text." }, { status: 400 });
  }

  let replyToMessage = null;
  if (body.replyToMessageId) {
    const snap = await db
      .collection("companies")
      .doc(companyId)
      .collection("email_messages")
      .doc(body.replyToMessageId)
      .get();
    if (snap.exists) {
      const d = snap.data() as { messageId?: string; references?: string[]; subject?: string };
      replyToMessage = {
        messageId: d.messageId ?? null,
        references: d.references ?? [],
        subject: d.subject ?? "",
      };
    }
  }

  try {
    const sent = await sendEmailFromAccount(db, companyId, accountId, {
      to,
      cc: body.cc,
      subject,
      textBody,
      htmlBody: body.htmlBody,
      replyToMessage,
    });
    await logEmailMailboxAudit(db, companyId, {
      actionType: "email_sent",
      actionLabel: "Odeslán e-mail",
      userId: perm.caller.uid,
      entityId: sent.messageDocId,
      metadata: { to, subject },
    });
    return NextResponse.json({ ok: true, ...sent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
