import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { EMAIL_SUBCOLLECTION_REMINDERS } from "@/lib/email-mailbox/intelligence-types";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

function resolveReminderDate(preset: string): Date | null {
  const now = new Date();
  switch (preset) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "today": {
      const d = new Date(now);
      d.setHours(17, 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d;
    }
    case "tomorrow": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "3d":
      return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: { companyId?: string; preset?: string; remindAt?: string };
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
  const m = access.message;

  const remindDate =
    body.remindAt && !Number.isNaN(Date.parse(body.remindAt))
      ? new Date(body.remindAt)
      : resolveReminderDate(String(body.preset ?? ""));
  if (!remindDate) {
    return NextResponse.json({ ok: false, error: "Neplatný termín připomenutí." }, { status: 400 });
  }

  const remindAt = Timestamp.fromDate(remindDate);

  await emailMessagesCol(perm.db, companyId).doc(messageId).update({
    reminderAt: remindAt,
    workflowState: "scheduled",
    updatedAt: FieldValue.serverTimestamp(),
  });

  await perm.db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(EMAIL_SUBCOLLECTION_REMINDERS)
    .add({
      organizationId: companyId,
      userId: perm.caller.uid,
      emailAccountId: m.emailAccountId,
      messageId,
      remindAt,
      preset: body.preset ?? null,
      fired: false,
      createdAt: FieldValue.serverTimestamp(),
    });

  await appendEmailMessageTimeline(perm.db, companyId, messageId, {
    kind: "reminder_set",
    label: "Naplánováno připomenutí",
    userId: perm.caller.uid,
    metadata: { remindAt: remindDate.toISOString() },
  });

  return NextResponse.json({ ok: true, remindAt: remindDate.toISOString() });
}
